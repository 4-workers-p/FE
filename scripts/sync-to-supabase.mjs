#!/usr/bin/env node
/**
 * GitHub -> Supabase `documents` 동기화 스크립트 (commercehub-be)
 *
 * - 아래 하드코딩된 PATH_PATTERNS에 매칭되는 마크다운 파일을 읽어
 *   documents 테이블에 upsert (source_type='github')
 * - 내용/최종 커밋 시각이 바뀐 파일만 반영하고, 바뀐 문서는 indexed_at을 null로 리셋해
 *   기존 `ingest` Edge Function이 다음 실행에서 자동으로 청킹/임베딩하도록 한다.
 * - 선택적으로 스크립트 마지막에 ingest Edge Function을 직접 호출해 즉시 청킹을 트리거한다.
 *
 * 동기화 대상을 바꾸려면 아래 REPO_FULL_NAME / BRANCH / PATH_PATTERNS만 수정하면 된다.
 *
 * 필요한 환경변수:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 * 선택 환경변수:
 *   INGEST_FUNCTION_URL      (예: https://<ref>.supabase.co/functions/v1/ingest)
 *   INGEST_API_SECRET
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ── 동기화 대상 설정 (하드코딩) ─────────────────────────────
const REPO_FULL_NAME = "4-workers-p/FE";
const BRANCH = "master";
const PATH_PATTERNS = ["README.md", "CLAUDE.md", "docs/**/*.md"];
// ────────────────────────────────────────────────────────

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const INGEST_FUNCTION_URL = process.env.INGEST_FUNCTION_URL ?? "";
const INGEST_API_SECRET = process.env.INGEST_API_SECRET ?? "";

const REPO_ROOT = process.cwd();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[sync-to-supabase] 필수 환경변수 누락: ${name}`);
    process.exit(1);
  }
  return value;
}

function restHeaders(extra = {}) {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

function walkMarkdown(dir, root, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMarkdown(full, root, out);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.add(path.relative(root, full).split(path.sep).join("/"));
    }
  }
}

/**
 * PATH_PATTERNS 지원 형식:
 *  - 정확한 상대경로 (예: "README.md")
 *  - "dir/**\/*.md" (해당 디렉터리 하위 모든 .md 재귀 포함)
 */
function expandPatterns(patterns, repoRoot) {
  const files = new Set();
  for (const pattern of patterns) {
    if (pattern.endsWith("/**/*.md")) {
      const dir = pattern.slice(0, -"/**/*.md".length);
      walkMarkdown(path.join(repoRoot, dir), repoRoot, files);
    } else {
      const full = path.join(repoRoot, pattern);
      if (fs.existsSync(full)) files.add(pattern);
    }
  }
  return [...files].sort();
}

function lastCommitIso(relPath) {
  try {
    const out = execSync(`git log -1 --format=%cI -- "${relPath}"`, {
      cwd: REPO_ROOT,
    })
      .toString()
      .trim();
    return out || new Date().toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function lastCommitSha(relPath) {
  try {
    return execSync(`git log -1 --format=%H -- "${relPath}"`, { cwd: REPO_ROOT })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

async function fetchExistingDocument(externalId) {
  const url = `${SUPABASE_URL}/rest/v1/documents?source_type=eq.github&external_id=eq.${encodeURIComponent(
    externalId
  )}&select=id,content,source_updated_at`;
  const res = await fetch(url, { headers: restHeaders() });
  if (!res.ok) {
    throw new Error(`documents 조회 실패: ${res.status} ${await res.text()}`);
  }
  const rows = await res.json();
  return rows[0] ?? null;
}

async function upsertDocument(doc) {
  const url = `${SUPABASE_URL}/rest/v1/documents?on_conflict=source_type,external_id`;
  const res = await fetch(url, {
    method: "POST",
    headers: restHeaders({
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    }),
    body: JSON.stringify([doc]),
  });
  if (!res.ok) {
    throw new Error(`documents upsert 실패: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function triggerIngest() {
  if (!INGEST_FUNCTION_URL || !INGEST_API_SECRET) {
    console.log("[sync-to-supabase] INGEST_FUNCTION_URL/INGEST_API_SECRET 미설정 — ingest 트리거 생략");
    return;
  }
  const res = await fetch(INGEST_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-secret": INGEST_API_SECRET,
    },
    body: JSON.stringify({ batchSize: 50 }),
  });
  const body = await res.text();
  console.log(`[sync-to-supabase] ingest 트리거 응답 (${res.status}): ${body}`);
}

async function main() {
  console.log(`[sync-to-supabase] repo=${REPO_FULL_NAME}`);

  const files = expandPatterns(PATH_PATTERNS, REPO_ROOT);
  console.log(`[sync-to-supabase] 대상 파일 ${files.length}개: ${files.join(", ")}`);

  let changedCount = 0;

  for (const relPath of files) {
    const absPath = path.join(REPO_ROOT, relPath);
    const content = fs.readFileSync(absPath, "utf8");
    const externalId = `${REPO_FULL_NAME}:${relPath}`;
    const committedAt = lastCommitIso(relPath);
    const sha = lastCommitSha(relPath);

    const existing = await fetchExistingDocument(externalId);
    const changed =
      !existing ||
      existing.content !== content ||
      existing.source_updated_at !== committedAt;

    if (!changed) {
      console.log(`  - skip (변경 없음): ${relPath}`);
      continue;
    }

    await upsertDocument({
      source_type: "github",
      external_id: externalId,
      title: `${REPO_FULL_NAME} · ${relPath}`,
      content,
      source_updated_at: committedAt,
      metadata: {
        repo: REPO_FULL_NAME,
        path: relPath,
        branch: BRANCH,
        commit_sha: sha,
        html_url: `https://github.com/${REPO_FULL_NAME}/blob/${BRANCH}/${relPath}`,
      },
      // 내용이 바뀐 문서만 재청킹 대상으로 표시
      indexed_at: null,
    });
    changedCount += 1;
    console.log(`  - upsert (변경됨): ${relPath}`);
  }

  console.log(`[sync-to-supabase] 완료: 변경 ${changedCount}건 / 전체 ${files.length}건`);

  if (changedCount > 0) {
    await triggerIngest();
  }
}

main().catch((err) => {
  console.error("[sync-to-supabase] 실패:", err);
  process.exit(1);
});
