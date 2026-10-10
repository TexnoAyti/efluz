import React, { createContext, lazy, useContext, useState } from 'react';
import { ContentBoundary } from '../components/ContentBoundary';

const UserProfileModal = lazy(() => import('../components/UserProfileModal').then(module => ({ default: module.UserProfileModal })));

interface UserProfileContextType {
  openUserProfile: (userId: string) => void;
  closeUserProfile: () => void;
}

const UserProfileContext = createContext<UserProfileContextType | undefined>(undefined);

interface UserProfileProviderProps {
  children: React.ReactNode;
  onSelectClub?: (clubId: string) => void;
}

export const UserProfileProvider: React.FC<UserProfileProviderProps> = ({
  children,
  onSelectClub,
}) => {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const openUserProfile = (userId: string) => {
    if (userId && userId.trim() !== '') {
      setSelectedUserId(userId);
    }
  };

  const closeUserProfile = () => {
    setSelectedUserId(null);
  };

  return (
    <UserProfileContext.Provider value={{ openUserProfile, closeUserProfile }}>
      {children}
      {selectedUserId && <ContentBoundary><UserProfileModal
        userId={selectedUserId}
        onClose={closeUserProfile}
        onSelectClub={onSelectClub}
      /></ContentBoundary>}
    </UserProfileContext.Provider>
  );
};

export function useUserProfile() {
  const context = useContext(UserProfileContext);
  if (!context) {
    throw new Error('useUserProfile must be used within a UserProfileProvider');
  }
  return context;
}
