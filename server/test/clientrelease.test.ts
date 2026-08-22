// 클라이언트(Electron) 설치파일 배포 저장소 — 게시(관리자 전용)·버전 비교·다운로드·삭제.
// 실제 100MB급 파일을 만들지 않기 위해 이 테스트에서는 작은 더미 버퍼를 "설치파일"로 쓴다.
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const tmpReleaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-client-releases-"));
process.env.GIJO_CLIENT_RELEASE_DIR = tmpReleaseDir;

const { createApp } = await import("../src/app");
const { resetUsersForTests } = await import("../src/auth/users");
const {
  compareVersions,
  publishClientRelease,
  getClientRelease,
  latestClientRelease,
  listClientReleases,
  deleteClientRelease,
  resetClientReleasesForTests,
} = await import("../src/engine/clientrelease");

async function login(app: ReturnType<typeof createApp>, username = "jyh", password = "changeme") {
  const res = await request(app).post("/api/auth/login").send({ username, password });
  return res.body as { accessToken: string };
}

describe("compareVersions", () => {
  it("숫자 단위로 비교한다(문자열 사전순이 아니라)", () => {
    expect(compareVersions("2.10.0", "2.9.0")).toBeGreaterThan(0); // 문자열 비교면 반대로 나옴
    expect(compareVersions("2.4.0", "2.4.0")).toBe(0);
    expect(compareVersions("2.3.9", "2.4.0")).toBeLessThan(0);
  });
});

describe("clientrelease — 게시·조회·삭제(함수 단위)", () => {
  beforeEach(() => resetClientReleasesForTests());

  it("게시하면 파일이 실제로 저장되고 sha256·크기가 기록된다", async () => {
    const buf = Buffer.from("가짜 설치파일 내용".repeat(100));
    const r = await publishClientRelease("2.5.0", "버그 수정", buf);
    expect(r.size).toBe(buf.length);
    expect(r.sha256).toHaveLength(64);
    expect(fs.existsSync(path.join(tmpReleaseDir, r.filename))).toBe(true);
    expect(getClientRelease("2.5.0")?.notes).toBe("버그 수정");
  });

  it("같은 버전을 다시 게시하면 덮어쓴다(재배포)", async () => {
    await publishClientRelease("2.5.0", "1차", Buffer.from("a"));
    await publishClientRelease("2.5.0", "2차(수정)", Buffer.from("bb"));
    expect(listClientReleases()).toHaveLength(1);
    expect(getClientRelease("2.5.0")?.notes).toBe("2차(수정)");
  });

  it("여러 버전 중 최신(숫자 최대)을 고른다", async () => {
    await publishClientRelease("2.4.0", "", Buffer.from("a"));
    await publishClientRelease("2.10.0", "", Buffer.from("b"));
    await publishClientRelease("2.9.0", "", Buffer.from("c"));
    expect(latestClientRelease()?.version).toBe("2.10.0");
  });

  it("x.y.z 형식이 아니면 거부한다", async () => {
    await expect(publishClientRelease("v2", "", Buffer.from("a"))).rejects.toThrow();
  });

  it("삭제하면 DB와 파일이 함께 없어진다", async () => {
    const r = await publishClientRelease("2.5.0", "", Buffer.from("a"));
    const filePath = path.join(tmpReleaseDir, r.filename);
    expect(fs.existsSync(filePath)).toBe(true);
    deleteClientRelease("2.5.0");
    expect(fs.existsSync(filePath)).toBe(false);
    expect(getClientRelease("2.5.0")).toBeUndefined();
  });
});

describe("clientrelease — REST API", () => {
  let app: ReturnType<typeof createApp>;
  let admin: { accessToken: string };

  beforeEach(async () => {
    resetClientReleasesForTests();
    resetUsersForTests();
    app = createApp();
    admin = await login(app);
  });

  it("관리자가 설치파일을 게시하면(raw octet-stream) 감사로그가 남고 목록·다운로드가 된다", async () => {
    const buf = Buffer.from("가짜 exe 내용");
    const publish = await request(app)
      .post("/api/client/releases?version=2.5.0&notes=버그수정")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .set("Content-Type", "application/octet-stream")
      .send(buf);
    expect(publish.status).toBe(200);
    expect(publish.body.release.version).toBe("2.5.0");

    const list = await request(app).get("/api/client/releases").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(list.body.releases).toHaveLength(1);

    const download = await request(app).get("/api/client/download/2.5.0").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(download.status).toBe(200);
    expect(Buffer.from(download.body).equals(buf)).toBe(true);
  });

  it("일반 담당자(security_officer)는 게시·목록·삭제를 할 수 없다(다운로드는 가능)", async () => {
    await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ username: "officer1", password: "pw123456", displayName: "담당자1", role: "security_officer" });
    const officer = await login(app, "officer1", "pw123456");

    const publish = await request(app)
      .post("/api/client/releases?version=2.5.0")
      .set("Authorization", `Bearer ${officer.accessToken}`)
      .set("Content-Type", "application/octet-stream")
      .send(Buffer.from("a"));
    expect(publish.status).toBe(403);

    await publishClientRelease("2.5.0", "", Buffer.from("a"));
    const list = await request(app).get("/api/client/releases").set("Authorization", `Bearer ${officer.accessToken}`);
    expect(list.status).toBe(403);

    // 다운로드는 일반 담당자도 가능해야 한다(설치는 누구나) — authMiddleware만, adminMiddleware 없음.
    const download = await request(app).get("/api/client/download/2.5.0").set("Authorization", `Bearer ${officer.accessToken}`);
    expect(download.status).toBe(200);
  });

  it("현재 버전보다 최신이 있으면 updateAvailable=true, 아니면 false", async () => {
    await publishClientRelease("2.5.0", "새 기능", Buffer.from("a"));

    const older = await request(app).get("/api/client/latest-release?current=2.4.0").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(older.body.updateAvailable).toBe(true);
    expect(older.body.latest.version).toBe("2.5.0");

    const same = await request(app).get("/api/client/latest-release?current=2.5.0").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(same.body.updateAvailable).toBe(false);

    const newer = await request(app).get("/api/client/latest-release?current=2.6.0").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(newer.body.updateAvailable).toBe(false);
  });

  it("게시된 릴리스가 없으면 latest=null·updateAvailable=false", async () => {
    const res = await request(app).get("/api/client/latest-release?current=2.4.0").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.body.latest).toBeNull();
    expect(res.body.updateAvailable).toBe(false);
  });

  it("없는 버전 다운로드는 404", async () => {
    const res = await request(app).get("/api/client/download/9.9.9").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★★ **에디션이 갈려 있는가** — 라이트에게 프로 설치본을 내려 주지 않는다 (2026-08-23)
//
// ■ 무엇이 있었나: `/api/client/latest-release`가 「전 에디션 통틀어 가장 높은 판」을 주고
//   클라는 **자기 에디션을 안 보냈다.** 라이트(1.3.0)가 업데이트를 물으면 프로 5.70.0이
//   「새 판」으로 나오고, 받으면 **라이트 설치가 프로로 갈아치워진다.**
//   ⚠ 판 번호가 안 겹친다고 안심할 수 없다 — `release-lite/`에 `Lite Setup 5.17.0`이 실재한다.
//
// ■ 이 감시가 지키는 것: ① 에디션 안에서만 최신을 고른다 ② 에디션을 안 주면 옛 동작(pro)
//   ③ 다른 에디션이 쓰는 판 번호를 **조용히 덮지 않는다**(PK가 version 하나라 덮으면 사라진다).
const { 에디션of } = await import("../src/engine/clientrelease");
const 게시 = publishClientRelease, 최신 = latestClientRelease, 비우기 = resetClientReleasesForTests;

describe("★ 클라 배포 채널이 에디션으로 갈려 있다", () => {
  it("★★ 라이트는 **라이트 판**만 최신으로 받는다 — 프로 판이 더 높아도", async () => {
    비우기();
    await 게시("5.70.0", "프로", Buffer.from("pro-installer"), "pro");
    await 게시("1.3.0", "라이트", Buffer.from("lite-installer"), "lite");

    const 라이트최신 = 최신("lite");
    expect(라이트최신?.version, "라이트가 프로 판을 최신으로 받는다 — 설치가 갈아치워진다").toBe("1.3.0");
    expect(에디션of(라이트최신!), "에디션 표시가 안 붙었다").toBe("lite");

    const 프로최신 = 최신("pro");
    expect(프로최신?.version, "프로가 라이트 판을 받는다").toBe("5.70.0");
  });

  it("★ 에디션을 안 주면 pro다 — **옛 클라의 동작이 한 톨도 안 바뀐다**", async () => {
    비우기();
    await 게시("5.70.0", "프로", Buffer.from("pro-installer"), "pro");
    await 게시("9.9.9", "라이트", Buffer.from("lite-installer"), "lite"); // 더 높은 라이트 판
    expect(최신()?.version, "에디션 미지정이 라이트 판을 집었다 — 옛 클라가 라이트를 받는다").toBe("5.70.0");
  });

  it("★★ 다른 에디션이 쓰는 판 번호는 **조용히 안 덮는다** — 덮으면 한쪽이 사라진다", async () => {
    비우기();
    await 게시("5.17.0", "프로", Buffer.from("pro-installer"), "pro");
    // 실제로 있었던 상황: release-lite에 `Lite Setup 5.17.0`이 존재한다.
    await expect(게시("5.17.0", "라이트", Buffer.from("lite-installer"), "lite"))
      .rejects.toThrow(/이미.*설치본이 쓰고 있습니다/);
    // 프로 것이 그대로 살아 있어야 한다.
    expect(최신("pro")?.notes).toBe("프로");
  });

  it("★ 파일 이름으로 무엇을 받았는지 알 수 있다", async () => {
    비우기();
    const l = await 게시("1.3.0", "라이트", Buffer.from("x"), "lite");
    const p = await 게시("5.70.0", "프로", Buffer.from("y"), "pro");
    expect(l.filename, "라이트 설치본인데 이름에 표시가 없다").toMatch(/Lite/);
    expect(p.filename, "프로 이름에 Lite가 들어갔다").not.toMatch(/Lite/);
  });

  it("★★ 클라가 **자기 에디션을 실어 보낸다** — 안 보내면 서버 갈래가 헛돈다", () => {
    const main = fs.readFileSync(path.resolve(process.cwd(), "..", "client", "src", "main.ts"), "utf8");
    // ⚠ 주소가 **두 조각으로 이어져** 있어도 잡아야 한다(줄 길이 때문에 나눠 썼다) —
    //   처음엔 백틱을 안 넘는 정규식으로 써서 이 시험이 스스로 헛실패했다.
    const 확인부 = main.slice(main.indexOf("latest-release"), main.indexOf("latest-release") + 400);
    expect(확인부, "업데이트 확인에 edition을 안 싣는다 — 라이트가 프로 판을 받는다")
      .toMatch(/edition=/);
    expect(확인부, "에디션 판별 함수를 안 부른다 — 상수를 박으면 라이트 빌드에서 틀린다")
      .toMatch(/에디션()/);
  });
});
