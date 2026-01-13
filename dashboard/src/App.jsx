// dashboard/src/App.jsx
import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Commands from './pages/Commands';
import Modules from './pages/Modules';
import Moderation from './pages/Moderation';
import Activity from './pages/Activity';
import Logging from './pages/Logging';
import Onboarding from './pages/Onboarding';
import { Users } from './pages/Placeholders';
import { AuthProvider, useAuth } from './context/AuthContext';
import { GuildProvider } from './context/GuildContext';
import { SnackbarProvider } from 'notistack';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div>Loading...</div>; // Or a spinner
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;

  return children;
}

function App() {
  return (
    <AuthProvider>
        <GuildProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            
            <Route path="/" element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }>
              <Route index element={<Navigate to="/general" replace />} />
              <Route path="general" element={<Dashboard />} />
              <Route path="commands" element={<Commands />} />
              <Route path="modules" element={<Modules />} />
              <Route path="moderation" element={<Moderation />} />
              <Route path="activity" element={<Activity />} />
              <Route path="logging" element={<Logging />} />
              <Route path="onboarding" element={<Onboarding />} />
              <Route path="users" element={<Users />} />
            </Route>
          </Routes>
        </GuildProvider>
    </AuthProvider>
  );
}

export default App;
