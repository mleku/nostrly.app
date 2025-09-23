import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

export const Route = createFileRoute('/profile')({
  component: Profile,
})

function Profile() {
  const [name, setName] = useState('')
  const [about, setAbout] = useState('')
  const queryClient = useQueryClient()

  const { data: profile, isLoading } = useQuery({
    queryKey: ['user-profile'],
    queryFn: async () => {
      // Placeholder - will be replaced with NDK profile fetching
      return {
        name: 'Anonymous',
        about: 'Nostr user',
        npub: 'npub1...',
        created_at: Date.now(),
      }
    },
  })

  const updateProfileMutation = useMutation({
    mutationFn: async (updates: { name: string; about: string }) => {
      // Placeholder - will be replaced with NDK profile update
      console.log('Updating profile:', updates)
      return { ...profile, ...updates }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-profile'] })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    updateProfileMutation.mutate({ name, about })
  }

  if (isLoading) {
    return <div className="profile-page">Loading profile...</div>
  }

  return (
    <div className="profile-page">
      <h2>Your Profile</h2>
      
      <div className="profile-info">
        <h3>Current Profile</h3>
        <p><strong>Name:</strong> {profile?.name}</p>
        <p><strong>About:</strong> {profile?.about}</p>
        <p><strong>Public Key:</strong> <code>{profile?.npub}</code></p>
      </div>

      <div className="profile-form">
        <h3>Update Profile</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="name">Display Name:</label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={profile?.name}
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="about">About:</label>
            <textarea
              id="about"
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder={profile?.about}
              rows={4}
            />
          </div>
          
          <button 
            type="submit" 
            disabled={updateProfileMutation.isPending}
          >
            {updateProfileMutation.isPending ? 'Updating...' : 'Update Profile'}
          </button>
        </form>
      </div>
    </div>
  )
}