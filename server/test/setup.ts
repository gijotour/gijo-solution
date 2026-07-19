// 전역 테스트 훅 — auth.ts의 refreshTokens/activeSessionByUser는 모듈 싱글턴이라
// createApp()을 새로 호출해도 초기화되지 않는다(같은 파일 안의 여러 it()가 재사용).
// 중복로그인 방지(9.5절 연장) 도입 이후엔 매 it()마다 세션이 깨끗해야 각 테스트가
// "새 로그인"으로 취급된다 — 그렇지 않으면 이전 it()이 남긴 세션 탓에 무관한 테스트가
// 409(already_logged_in)로 실패한다.
import { beforeEach } from "vitest";
import { resetAuthForTests } from "../src/auth/auth";

beforeEach(() => {
  resetAuthForTests();
});
