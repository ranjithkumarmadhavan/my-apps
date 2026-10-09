// Thin client for the shared account API and the SplitEasy API.

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function post(url, body) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 0);
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    // fall through with an empty body
  }
  if (!res.ok) {
    if (res.status === 401 && url === API) window.dispatchEvent(new Event('spliteasy:signed-out'));
    throw new ApiError(data.error || 'Something went wrong. Please try again.', res.status);
  }
  return data;
}

const AUTH = '/api/auth.php';
const API = `${import.meta.env.BASE_URL}api/index.php`;

export const auth = (action, body = {}) => post(AUTH, { action, ...body });
export const api = (action, body = {}) => post(API, { action, ...body });
