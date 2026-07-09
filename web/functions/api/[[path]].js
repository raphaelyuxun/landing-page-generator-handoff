// CF Pages Function：把主域 easesourcer.omni-marketeer.com 的 /api/* 反代回后端
// easesourcer-api.omni-marketeer.com（前端迁 CF Pages 后，对外 /api/ext 契约靠这里保住）。
// 只拦 /api/*；其余路径由 Pages 静态/SPA 兜底，前端零影响。
export async function onRequest({ request }) {
  const url = new URL(request.url);
  const target = "https://easesourcer-api.omni-marketeer.com" + url.pathname + url.search;
  const headers = new Headers(request.headers);
  headers.delete("host"); // 让 fetch 按目标 URL 设 Host，否则隧道会按原域名误路由
  return fetch(target, {
    method: request.method,
    headers,                                   // 透传 X-API-Key / Content-Type / Authorization
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    redirect: "manual",
  });
}
