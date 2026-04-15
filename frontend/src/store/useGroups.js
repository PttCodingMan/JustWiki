import { create } from 'zustand'
import api from '../api/client'

// Groups + membership store. Used both by the Admin > Groups section and
// (in the next commit) by the AclManager picker.
const useGroups = create((set, get) => ({
  groups: [],
  loading: false,
  membersByGroup: {}, // group_id -> list of member user records

  fetchGroups: async () => {
    set({ loading: true })
    try {
      const res = await api.get('/groups')
      set({ groups: res.data || [], loading: false })
    } catch {
      set({ loading: false })
    }
  },

  createGroup: async (name, description = '') => {
    const res = await api.post('/groups', { name, description })
    await get().fetchGroups()
    return res.data
  },

  deleteGroup: async (id) => {
    await api.delete(`/groups/${id}`)
    await get().fetchGroups()
    // Also drop any cached membership for the deleted group.
    set((state) => {
      const next = { ...state.membersByGroup }
      delete next[id]
      return { membersByGroup: next }
    })
  },

  fetchMembers: async (groupId) => {
    const res = await api.get(`/groups/${groupId}/members`)
    set((state) => ({
      membersByGroup: { ...state.membersByGroup, [groupId]: res.data || [] },
    }))
    return res.data
  },

  addMember: async (groupId, userId) => {
    await api.post(`/groups/${groupId}/members`, { user_id: userId })
    await get().fetchMembers(groupId)
  },

  removeMember: async (groupId, userId) => {
    await api.delete(`/groups/${groupId}/members/${userId}`)
    await get().fetchMembers(groupId)
  },
}))

export default useGroups
