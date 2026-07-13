// util/asyncRoute.ts — Express 4는 async 핸들러가 reject해도 자동으로 잡지 않아,
// 처리되지 않은 예외가 프로세스 전체를 죽인다. 모든 라우트를 이 래퍼로 감싸
// 해당 요청만 500으로 실패하도록 격리한다.

import type { NextFunction, Request, RequestHandler, Response } from "express";

export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch((err) => {
      console.error(`[${req.method} ${req.path}]`, err);
      if (!res.headersSent) res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    });
  };
}
