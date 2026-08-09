#!/usr/bin/env node
/**
 * GitHub -> Supabase `documents` 동기화 스크립트 (commercehub-fe)
 *
 * - 아래 하드코딩된 PATH_PATTERNS에 매칭되는 마크다운 파일을 읽어
 *   문단 단위로 청킹한 뒤, 조각마다 documents 테이블에 별도 row로 upsert (source_type='github')
 * - 청킹은 여기(GitHub Actions)에서 직접 수행한다. embed-documents(구 ingest) 함수는
 *   더 이상 조각내지 않고, 이미 작은 단위로 들어온 각 row를 그대로 임베딩만 하면 된다.
 *   (embed-documents 쪽 enable_auto_chunking은 꺼두는 것을 권장 — 이 저장소 코드 범위 밖)
 * - 파일의 마지막 커밋 시각이 바뀐 경우에만 그 파일의 기존 조각들을 전부 삭제하고 새로 삽입한다.
 *   (조각 개수가 달라져도 오래된 조각이 남지 않도록 delete-then-insert 방식)
 *
 * 동기화 대상을 바꾸려면 아래 REPO_FULL_NAME / BRANCH / PATH_PATTERNS만 수정하면 된다.
 *
 * 필요한 환경변수:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ── 동기화 대상 설정 (하드코딩) ─────────────────────────────
const REPO_FULL_NAME = "4-workers-p/FE";
const BRANCH = "master";
const PATH_PATTERNS = ["README.md", "CLAUDE.md", "docs/**/*.md"];
// ────────────────────────────────────────────────────────

// ── 청킹 설정 (Voyage 기본값과 동일하게 문자 기준) ───────────────
const CHUNK_SIZE = 512;
const CHUNK_OVERLAP = 64;
// ────────────────────────────────────────────────────────

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

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

/**
 * 문단(빈 줄) 단위로 묶어가며 chunkSize를 넘지 않게 그리디하게 채우고,
 * 다음 조각 시작에 이전 조각 끝부분(chunkOverlap)을 이어붙여 문맥이 끊기지 않게 한다.
 * 문단 하나가 chunkSize보다 크면 강제로 잘라낸다.
 */
function chunkText(text, chunkSize = CHUNK_SIZE, chunkOverlap = CHUNK_OVERLAP) {
  const paragraphs = text
    .trim()
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return [];

  const chunks = [];
  let current = "";

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
  };

  for (const paragraph of paragraphs) {
    let candidate = current ? `${current}\n\n${paragraph}` : paragraph;

    if (candidate.length <= chunkSize) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current.trim());
      const overlapText = current.slice(-chunkOverlap).trim();
      current = overlapText ? `${overlapText}\n\n${paragraph}` : paragraph;
    } else {
      current = paragraph;
    }

    // 문단 자체가 chunkSize보다 큰 경우 강제 분할
    while (current.length > chunkSize) {
      chunks.push(current.slice(0, chunkSize).trim());
      current = current.slice(chunkSize - chunkOverlap);
    }
  }

  flush();
  return chunks;
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

/** 파일의 첫 번째 조각(#0)만 조회해서 파일이 바뀌었는지 판단하는 마커로 쓴다. */
async function fetchChunkMarker(firstChunkExternalId) {
  const url = `${SUPABASE_URL}/rest/v1/documents?source_type=eq.github&external_id=eq.${encodeURIComponent(
    firstChunkExternalId
  )}&select=source_updated_at`;
  const res = await fetch(url, { headers: restHeaders() });
  if (!res.ok) {
    throw new Error(`documents 조회 실패: ${res.status} ${await res.text()}`);
  }
  const rows = await res.json();
  return rows[0] ?? null;
}

async function deleteChunksByPrefix(prefix) {
  const url = `${SUPABASE_URL}/rest/v1/documents?source_type=eq.github&external_id=like.${encodeURIComponent(
    `${prefix}*`
  )}`;
  const res = await fetch(url, { method: "DELETE", headers: restHeaders() });
  if (!res.ok) {
    throw new Error(`documents 삭제 실패: ${res.status} ${await res.text()}`);
  }
}

async function insertDocuments(docs) {
  if (docs.length === 0) return;
  const url = `${SUPABASE_URL}/rest/v1/documents`;
  const res = await fetch(url, {
    method: "POST",
    headers: restHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify(docs),
  });
  if (!res.ok) {
    throw new Error(`documents insert 실패: ${res.status} ${await res.text()}`);
  }
}

async function main() {
  console.log(`[sync-to-supabase] repo=${REPO_FULL_NAME}`);

  const files = expandPatterns(PATH_PATTERNS, REPO_ROOT);
  console.log(`[sync-to-supabase] 대상 파일 ${files.length}개: ${files.join(", ")}`);

  let changedFileCount = 0;
  let totalChunkCount = 0;

  for (const relPath of files) {
    const absPath = path.join(REPO_ROOT, relPath);
    const rawContent = fs.readFileSync(absPath, "utf8");
    const committedAt = lastCommitIso(relPath);
    const sha = lastCommitSha(relPath);

    const externalIdBase = `${REPO_FULL_NAME}:${relPath}`;
    const prefix = `${externalIdBase}#`;

    const marker = await fetchChunkMarker(`${prefix}0`);
    const unchanged = marker && marker.source_updated_at === committedAt;

    if (unchanged) {
      console.log(`  - skip (변경 없음): ${relPath}`);
      continue;
    }

    const chunks = chunkText(rawContent);

    if (chunks.length === 0) {
      console.log(`  - skip (빈 파일): ${relPath}`);
      continue;
    }

    // 조각 개수가 이전과 달라져도 오래된 조각이 남지 않도록 통째로 교체
    await deleteChunksByPrefix(prefix);

    const docs = chunks.map((chunkContent, index) => ({
      source_type: "github",
      external_id: `${prefix}${index}`,
      title: `${REPO_FULL_NAME} · ${relPath} (${index + 1}/${chunks.length})`,
      content: chunkContent,
      source_updated_at: committedAt,
      metadata: {
        repo: REPO_FULL_NAME,
        path: relPath,
        branch: BRANCH,
        commit_sha: sha,
        html_url: `https://github.com/${REPO_FULL_NAME}/blob/${BRANCH}/${relPath}`,
        chunk_index: index,
        chunk_count: chunks.length,
        chunking: "pre-chunked-by-sync-script",
      },
      // 새 조각이므로 임베딩 대상으로 표시
      indexed_at: null,
    }));

    await insertDocuments(docs);
    changedFileCount += 1;
    totalChunkCount += chunks.length;
    console.log(`  - upsert (변경됨): ${relPath} → ${chunks.length}개 조각`);
  }

  console.log(
    `[sync-to-supabase] 완료: 변경된 파일 ${changedFileCount}개 / 전체 ${files.length}개, 새로 저장된 조각 ${totalChunkCount}개`
  );
}

main().catch((err) => {
  console.error("[sync-to-supabase] 실패:", err);
  process.exit(1);
});
