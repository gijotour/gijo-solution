// auth/users.ts — 보안담당자 계정 저장소
// TODO: 실제로는 별도 DB(예: sqlite) + bcrypt 해시로 교체. 지금은 스캐폴딩용 인메모리 시드.

export interface GijoUser {
  id: string;
  username: string;
  passwordHash: string; // TODO: bcrypt.hash 결과로 교체
  displayName: string;
  role: "security_officer" | "admin";
}

// TODO: 초기 배포 시 설치 마법사에서 관리자 계정을 직접 생성하도록 변경 (하드코딩 금지)
export const users: GijoUser[] = [
  { id: "u1", username: "jyh", passwordHash: "changeme", displayName: "정요한", role: "admin" },
];

export function findUserByUsername(username: string): GijoUser | undefined {
  return users.find((u) => u.username === username);
}

export function findUserById(id: string): GijoUser | undefined {
  return users.find((u) => u.id === id);
}
