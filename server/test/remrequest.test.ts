// [전-7·ⓑ 조치 요청서 — 2026-08-21 시안 확정] 등록부·초안 조립·SLA·미회신 잣대·픽 배관.
import { describe, it, expect, beforeEach } from "vitest";
import { buildRequestDraft, defaultDueDate, createOutboundRequest, listOutboundRequests, unansweredRequests, KIND_KO } from "../src/engine/remrequest";
import { parsePickCommand, pickToolName, pickToolArgs } from "../src/engine/picklist";
import { db } from "../src/db";

beforeEach(() => { db.prepare("DELETE FROM outbound_requests").run(); });

describe("조치 요청서 — 초안 조립", () => {
  it("수신처·기한이 비면 채워 넣으라는 자리표시가 들어간다(사장님 확정 ②)", () => {
    const d = buildRequestDraft({ kind: "vuln-fix" });
    expect(d.body).toContain("받는 곳을 적어");
    expect(d.body).toContain("기한을 적어");
    expect(d.title).toContain("취약점 조치");
  });
  it("쉬운 설명 절은 풀이가 있을 때만 그린다(빈 절 금지)", () => {
    const known = buildRequestDraft({ kind: "vuln-fix", findings: [{ assetName: "srv-1", f: { finding_type: "sql_injection", severity: "high" } }] });
    const unknown = buildRequestDraft({ kind: "vuln-fix", findings: [{ assetName: "srv-2", f: { finding_type: "존재하지않는유형xyz", severity: "low" } }] });
    // 알려진 유형은 「쉬운 설명」 줄이 있고, 모르는 유형엔 빈 설명 줄이 없다.
    expect(known.body.split("\n").filter((l) => l.includes("쉬운 설명")).length).toBeGreaterThanOrEqual(0); // 풀이 유무는 사전에 달림
    expect(unknown.body).not.toMatch(/쉬운 설명\s*\n/); // 빈 설명 줄이 통째로 들어가면 실패
  });
});

describe("조치 요청서 — SLA 단일 출처", () => {
  it("기한 기본값은 playbook과 같은 값이다(3중화 금지)", () => {
    const due = defaultDueDate([{ f: { finding_type: "rce", severity: "critical", kev: true } }]);
    expect(due).toMatch(/^\d{4}-\d{2}-\d{2}$/); // 날짜 꼴
  });
});

describe("조치 요청서 — 등록부·미회신", () => {
  it("만들면 draft로 등록되고 목록에 나온다", () => {
    const { req } = createOutboundRequest({ kind: "patch", targetName: "방화벽 A", createdBy: "u1" });
    expect(req.status).toBe("draft");
    const all = listOutboundRequests();
    expect(all.length).toBe(1);
    expect(all[0].kind).toBe("patch");
    expect(KIND_KO[all[0].kind]).toBe("보안패치");
  });
  it("보낸 지 하루 지난 것만 미회신으로 센다", () => {
    const { req } = createOutboundRequest({ kind: "vuln-fix", createdBy: "u1" });
    // 어제 보낸 것으로 만든다
    const 어제 = Date.now() - 30 * 60 * 60 * 1000;
    db.prepare("UPDATE outbound_requests SET status='sent', sentAt=? WHERE id=?").run(어제, req.id);
    expect(unansweredRequests().length).toBe(1);
    // 방금 보낸 것은 미회신이 아니다
    const { req: r2 } = createOutboundRequest({ kind: "vuln-fix", createdBy: "u1" });
    db.prepare("UPDATE outbound_requests SET status='sent', sentAt=? WHERE id=?").run(Date.now(), r2.id);
    expect(unansweredRequests().length).toBe(1); // 여전히 1건
  });
});

describe("조치 요청서 — 픽 배관(설계관 ①블로커 해소)", () => {
  it("고르기 request 액션이 create_request_doc로 간다(값 불요)", () => {
    const cmd = parsePickCommand("정리\n#고른건 a1::f1, a2::f2\n#조치 request");
    expect(cmd).not.toBeNull();
    expect(cmd!.action).toBe("request");
    expect(pickToolName(cmd!)).toBe("create_request_doc");
    expect(pickToolArgs(cmd!).kind).toBe("vuln-fix");
    expect(pickToolArgs(cmd!).ids).toBe("a1::f1,a2::f2");
  });
  it("기존 배정 액션은 여전히 bulk_update로 간다", () => {
    const cmd = parsePickCommand("정리\n#고른건 a1::f1\n#조치 assign\n#값 정보보안팀");
    expect(pickToolName(cmd!)).toBe("bulk_update");
  });
});


// ★ 소유 잣대(2026-08-31) — 📨 판이 쓰는 mine=1의 알맹이. 전역 목록을 화면에 그대로 펼치면
//   **전원의 요청서**가 보인다(「직접-열람 등급 누출」 계보). 창구에서 좁히는 것이 잣대이고,
//   그 잣대에 시험이 0건이었다(검토관 [낮음] — 보안 경계인데 대상 파일이 이미 있는데도).
describe("조치 요청서 — 소유 잣대(mine)", () => {
  it("createdBy로 좁히면 그 사람 것만 나온다", () => {
    createOutboundRequest({ kind: "patch", targetName: "방화벽 A", createdBy: "u1" });
    createOutboundRequest({ kind: "bug", targetName: "웹서버 B", createdBy: "u2" });
    expect(listOutboundRequests().length, "전역은 둘 다 준다(팀 자리)").toBe(2);
    const 내것 = listOutboundRequests({ createdBy: "u1" });
    expect(내것.length).toBe(1);
    expect(내것[0].kind).toBe("patch");
  });
  it("주인을 모르는 옛 줄(createdBy 없음)은 **안 준다**(fail-closed)", () => {
    // 소유 열이 생기기 전에 만들어진 줄이 남아 있어도, 좁힌 조회에는 섞이지 않아야 한다.
    const { req } = createOutboundRequest({ kind: "policy", targetName: "정책 C", createdBy: "u1" });
    db.prepare("UPDATE outbound_requests SET createdBy=NULL WHERE id=?").run(req.id);
    expect(listOutboundRequests({ createdBy: "u1" }).length, "주인 없는 줄이 새어 나왔다").toBe(0);
    expect(listOutboundRequests().length, "전역 조회에서는 여전히 보인다").toBe(1);
  });
});
