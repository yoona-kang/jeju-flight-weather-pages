export function resolveApiURL(path, config = {}, documentBase = globalThis.document?.baseURI) {
  if (!/^api\/(health|bootstrap|flights|predict)(\?|$)/.test(path)) throw new Error('지원하지 않는 조회 경로입니다.');
  if (config.apiMode !== 'external') return new URL(path, documentBase).href;
  if (!config.apiBaseUrl) {
    const error = new Error('실시간 항공편 조회 연결을 준비하고 있습니다. 연결이 완료되면 이 화면에서 조회할 수 있어요.');
    error.code = 'api_not_configured';
    throw error;
  }
  const base = new URL(config.apiBaseUrl);
  const localPage = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(documentBase).hostname);
  const localAPI = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (base.username || base.password || base.search || base.hash || (base.protocol !== 'https:' && !(localPage && localAPI && base.protocol === 'http:'))) {
    throw new Error('조회 서버의 연결 주소를 확인해 주세요.');
  }
  return new URL(path, base.href.replace(/\/?$/, '/')).href;
}
