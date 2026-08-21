// [전-7·문서 핵심 — URL 지식화(2026-08-21 사장님 「일단 가능하게」)]
// 순수 함수(본문 발라내기·유튜브 판별·사설망 차단)를 실코드로 검증한다. 실제 fetch는
// 에어갭·망 사정에 좌우되므로 여기서 안 한다(라이브 검증은 배포 후 실측 몫).
import { describe, it, expect } from "vitest";
import { extractMainText, isPrivateTarget, isYoutubeUrl } from "../src/engine/urlingest";

describe("URL 지식화 — 본문 발라내기(결정적 ①층)", () => {
  it("스크립트·꾸밈을 걷고 본문만 남긴다 — article 우선", () => {
    const html = `<html><head><title>보안 리포트 | 소만사</title><style>.x{}</style></head>
      <body><nav>메뉴 홈 로그인</nav>
      <article><h1>개인정보 유출 동향</h1><p>2026년 상반기 유출 사고는 전년 대비 증가했다.</p>
      <p>${"내부 통제와 DLP 정책 정비가 필요하다. ".repeat(12)}</p></article>
      <script>alert(1)</script><footer>회사소개 약관</footer></body></html>`;
    const r = extractMainText(html);
    expect(r.title).toContain("보안 리포트");
    expect(r.text).toContain("유출 동향");
    expect(r.text).toContain("전년 대비 증가");
    expect(r.text).not.toContain("alert(1)");
    expect(r.text).not.toContain("메뉴 홈 로그인"); // nav는 지식이 아니다
  });

  it("엔티티를 되살리고 공백을 정리한다", () => {
    const r = extractMainText("<body><main><p>A &amp; B &lt;표&gt;   많은    공백" + " 본문이 이백 자를 넘어야 main을 채택한다.".repeat(10) + "</p></main></body>");
    expect(r.text).toContain("A & B <표>");
    expect(r.text).not.toMatch(/ {2,}/);
  });
});

describe("URL 지식화 — 보안 경계", () => {
  it("사설망·루프백·메타데이터 주소는 거절한다(SSRF 방어)", () => {
    for (const u of ["http://localhost:4000/x", "http://127.0.0.1/", "http://10.8.0.1/", "http://192.168.219.66/", "http://172.16.0.9/", "http://169.254.169.254/meta", "http://server.internal/"]) {
      expect(isPrivateTarget(new URL(u)), u + " 는 막혀야 한다").toBe(true);
    }
  });
  it("공개 주소는 통과한다", () => {
    for (const u of ["https://www.somansa.com/ko/x", "https://youtu.be/abc", "https://www.cisa.gov/kev"]) {
      expect(isPrivateTarget(new URL(u)), u).toBe(false);
    }
  });
  it("유튜브 판별 — youtube.com·youtu.be만, 짝퉁 도메인은 아니다", () => {
    expect(isYoutubeUrl(new URL("https://www.youtube.com/watch?v=x"))).toBe(true);
    expect(isYoutubeUrl(new URL("https://youtu.be/x"))).toBe(true);
    expect(isYoutubeUrl(new URL("https://notyoutube.com/watch"))).toBe(false);
    expect(isYoutubeUrl(new URL("https://youtube.com.evil.io/x"))).toBe(false);
  });
});
