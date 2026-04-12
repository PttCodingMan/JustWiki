import axios from 'axios'

// Axios instance used by the public read-only viewer.
// - No credentials: anonymous visitors never send cookies
// - No 401 interceptor: a failed public request must NOT redirect to /login
const publicApi = axios.create({
  baseURL: '/api/public',
  withCredentials: false,
})

export default publicApi
