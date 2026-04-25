// Tiny shared mailbox so api/client.js can know "is the current user a
// guest?" without importing the Zustand store (which would create a cycle:
// useAuth → api → useAuth). useAuth.checkAuth flips this whenever the user
// state changes; the axios interceptor reads it to decide whether a 401
// should bounce the user to /login or just propagate to the caller.
let _isGuest = false

export const setGuestMode = (v) => {
  _isGuest = !!v
}

export const isGuestMode = () => _isGuest
