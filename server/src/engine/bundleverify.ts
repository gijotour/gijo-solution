// engine/bundleverify.ts — 지식 번들(.gijobundle) 서명 검증. (계획서 후-3 2단계)
//
// ■ 왜 이게 먼저인가
//   번들 반입은 그대로 두면 **공급망 공격 경로**다. 가짜 번들 하나면 온톨로지가 통째로
//   오염되고, 그 뒤로 AI가 하는 모든 답이 조작된다. 오늘 막은 간접 프롬프트 주입과 같은
//   계열인데 파급이 훨씬 크다 — 그건 답 하나가 흔들리는 것이고 이건 지식 자체가 바뀐다.
//   그래서 **빌더보다 검증을 먼저** 짜고, 검증을 통과하지 못하면 **경고가 아니라 거부**한다.
//
// ■ 형식을 zip이 아니라 gzip(JSON)으로 한 이유 (설계안의 "실체는 zip"에서 바꿈)
//   ① zip 라이브러리를 새로 들여야 하는데 번들 전체가 수백 KB다 — 값이 안 맞는다.
//   ② zip은 **압축 해제 경로(zip-slip)** 가 늘 딸려온다. 항목 이름에 `../`를 넣어 엉뚱한
//      곳에 쓰게 만드는 고전적 공격인데, 우리는 파일을 풀어 놓을 필요가 아예 없다.
//      내용은 메모리에서 읽어 기존 멱등 인입 경로로 넘기면 된다 — **그 취약점이 생길 자리를
//      만들지 않는 것**이 막는 것보다 낫다.
//   ③ gzip을 풀면 사람이 읽을 수 있는 JSON이다. 폐쇄망 반입 심사에서 이게 중요하다.
//
// ■ 서명이 덮는 범위 (두 겹)
//   서명은 **manifest만** 덮는다. 대신 manifest가 payload의 sha256을 들고 있다.
//     서명 검증  → manifest가 우리 것임이 증명됨
//     해시 대조  → payload가 그 manifest가 말하는 그것임이 증명됨
//   둘 다 통과해야 반입한다. 하나만 보면 나머지 절반이 무방비다.
import crypto from "crypto";
import zlib from "zlib";

/** 이 제품이 신뢰하는 발행 공개키. 개인키는 GIJO 빌드 환경에만 있고 제품에 실리지 않는다. */
export const BUNDLE_PUBLIC_KEYS: { keyId: string; spkiBase64: string }[] = [
  // 2026년 발행키. 키를 갈면 **옛 키를 지우지 않고 여기 덧붙인다** — 이미 배포된 번들이
  // 갑자기 검증 실패하면 안 된다. 폐기가 필요하면 그때 명시적으로 뺀다.
  { keyId: "gijo-2026", spkiBase64: "MCowBQYDK2VwAyEAtrC37/48RV4zVkbdzbCX4dN1Of5hevjs5tmtdlZDbhQ=" },
];

/** 번들 파일 최대 크기 — 압축 폭탄과 실수로 통째로 만든 파일을 함께 막는다. */
const MAX_BUNDLE_BYTES = 64 * 1024 * 1024; // 64MB(현재 실측 번들은 1MB 미만)
const MAX_UNPACKED_BYTES = 256 * 1024 * 1024; // 압축 해제 후 상한

export interface BundleManifest {
  version: string; // 예 "2026.10-1"
  issuedAt: string; // ISO
  producer: string;
  counts: { triples: number; docs: number };
  attributions: string[];
  payloadSha256: string;
}

export interface BundlePayload {
  ontology: { subject: string; predicate: string; object: string; scope?: string; source?: string }[];
  docs: { file: string; sha256: string; contentBase64: string }[];
}

export interface BundleFile {
  format: string;
  manifest: BundleManifest;
  signature: { alg: string; keyId: string; sig: string };
  payload: BundlePayload;
}

export const BUNDLE_FORMAT = "gijobundle/1";

/**
 * 결정적 JSON 직렬화 — 서명 대상이므로 **키 순서가 흔들리면 서명이 깨진다.**
 * JSON.stringify는 키 순서를 객체 생성 순서대로 내는데, 만드는 쪽과 읽는 쪽에서
 * 그 순서가 같으리라는 보장이 없다(파싱은 원문 순서를 따르지만 가공하면 달라진다).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

export function sha256Hex(s: string | Buffer): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export interface VerifyResult {
  ok: boolean;
  reason?: string; // 거부 사유 — 담당자가 읽고 판단할 한 줄
  manifest?: BundleManifest;
  payload?: BundlePayload;
}

/** 거부는 한 곳에서 만든다 — 사유 문구가 제각각이면 화면·감사·시험이 어긋난다. */
function deny(reason: string): VerifyResult {
  return { ok: false, reason };
}

/**
 * 번들 파일(gzip 바이트)을 검증한다. **통과하지 못하면 아무것도 반환하지 않는다** —
 * 호출자가 실수로 payload를 쓰는 일이 없게 ok=false면 payload를 아예 안 담는다.
 */
export function verifyBundle(raw: Buffer): VerifyResult {
  if (!Buffer.isBuffer(raw) || raw.length === 0) return deny("빈 파일입니다.");
  if (raw.length > MAX_BUNDLE_BYTES) {
    return deny(`파일이 너무 큽니다(${Math.round(raw.length / 1048576)}MB) — 허용 ${MAX_BUNDLE_BYTES / 1048576}MB.`);
  }

  // ① 압축 해제 — 깨진 파일·다른 형식이 여기서 걸린다. 예외를 밖으로 던지지 않는다
  //    (반입 화면이 스택트레이스를 보여주면 그것 자체가 정보 노출이다).
  let text: string;
  try {
    text = zlib.gunzipSync(raw, { maxOutputLength: MAX_UNPACKED_BYTES }).toString("utf8");
  } catch {
    return deny("번들 파일을 읽을 수 없습니다 — 손상됐거나 GIJO 번들 형식이 아닙니다.");
  }

  let file: BundleFile;
  try {
    file = JSON.parse(text) as BundleFile;
  } catch {
    return deny("번들 내용이 올바른 형식이 아닙니다.");
  }

  // ② 형식 표기 — 미래 형식을 옛 코드가 제멋대로 해석하지 않게 정확히 일치할 때만 진행.
  if (file?.format !== BUNDLE_FORMAT) {
    return deny(`지원하지 않는 번들 형식입니다(${String(file?.format ?? "표기 없음")}) — 제품을 최신으로 올려 주세요.`);
  }
  if (!file.manifest || !file.payload) return deny("번들에 매니페스트 또는 내용이 없습니다.");

  // ③ 서명 존재 — **없으면 거부한다.** "서명 없는 번들은 경고만" 같은 예외를 두는 순간
  //    공격자는 서명을 빼고 보내면 된다. 예외를 만들지 않는 것이 이 방어의 전부다.
  const sig = file.signature;
  if (!sig?.sig || !sig.keyId) return deny("서명이 없는 번들입니다 — 반입할 수 없습니다.");
  if (sig.alg !== "Ed25519") return deny(`지원하지 않는 서명 방식입니다(${String(sig.alg)}).`);

  const known = BUNDLE_PUBLIC_KEYS.find((k) => k.keyId === sig.keyId);
  if (!known) return deny(`모르는 서명 키입니다(${sig.keyId}) — GIJO가 발행한 번들이 아닙니다.`);

  // ④ 서명 검증 — manifest의 결정적 직렬화에 대해.
  let sigOk = false;
  try {
    const pub = crypto.createPublicKey({
      key: Buffer.from(known.spkiBase64, "base64"),
      format: "der",
      type: "spki",
    });
    sigOk = crypto.verify(null, Buffer.from(canonicalJson(file.manifest), "utf8"), pub, Buffer.from(sig.sig, "base64"));
  } catch {
    sigOk = false;
  }
  if (!sigOk) return deny("서명이 맞지 않습니다 — 번들이 변조됐거나 GIJO가 발행한 것이 아닙니다.");

  // ⑤ 내용 해시 대조 — 서명은 manifest만 덮으므로 여기서 payload를 manifest에 묶는다.
  //    이게 없으면 진짜 manifest에 가짜 payload를 붙인 번들이 통과한다.
  const actual = sha256Hex(canonicalJson(file.payload));
  if (actual !== file.manifest.payloadSha256) {
    return deny("번들 내용이 서명된 목록과 다릅니다 — 전송 중 변조됐을 수 있습니다.");
  }

  // ⑥ 개별 문서 지문 — payload 전체 해시는 맞아도 각 문서가 자기 sha256과 맞는지는 별개다.
  //    빌더 버그로 어긋난 채 서명될 수 있어 반입 직전에 한 번 더 본다.
  for (const d of file.payload.docs ?? []) {
    if (!isSafeDocName(d.file)) {
      return deny(`문서 이름이 올바르지 않습니다(${String(d.file).slice(0, 60)}) — 경로가 섞인 이름은 받지 않습니다.`);
    }
    let buf: Buffer;
    try {
      buf = Buffer.from(d.contentBase64, "base64");
    } catch {
      return deny(`문서를 읽을 수 없습니다: ${d.file}`);
    }
    if (sha256Hex(buf) !== d.sha256) return deny(`문서 지문이 맞지 않습니다: ${d.file}`);
  }

  // ⑦ 선언한 개수와 실제 개수 — 어긋나면 만드는 쪽이 잘못된 것이므로 받지 않는다.
  const nOnto = file.payload.ontology?.length ?? 0;
  const nDocs = file.payload.docs?.length ?? 0;
  if (file.manifest.counts?.triples !== nOnto || file.manifest.counts?.docs !== nDocs) {
    return deny(`번들 목록과 실제 내용이 다릅니다(지식 ${nOnto}건·문서 ${nDocs}건).`);
  }

  return { ok: true, manifest: file.manifest, payload: file.payload };
}

/**
 * 문서 이름 안전성 — 경로 구분자·상위 이동·절대경로·널바이트를 막는다.
 * zip을 안 써서 풀어 쓰는 경로가 없지만, 이 이름은 문서 식별자로 DB와 인입 경로에 들어간다.
 * "취약점이 생길 자리를 안 만든다"와 별개로, 이름 자체를 정상 범위로 좁혀 둔다.
 */
export function isSafeDocName(name: unknown): boolean {
  if (typeof name !== "string" || !name || name.length > 200) return false;
  if (name.includes("\0")) return false;
  if (/[\\/]/.test(name)) return false; // 경로 구분자 금지 — 파일명만 받는다
  if (name.startsWith(".")) return false; // ".." 및 숨김 이름
  return /^[\w가-힣][\w가-힣 .()\-]*\.(md|txt|json)$/.test(name);
}
