import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from './AuthContext';

const GuildContext = createContext(null);

export const GuildProvider = ({ children }) => {
  const { user } = useAuth();
  const [guildId, setGuildId] = useState(() => localStorage.getItem('selectedGuildId') || '');
  const [channels, setChannels] = useState([]);
  const [roles, setRoles] = useState([]);
  const [botMember, setBotMember] = useState(null);
  const [loading, setLoading] = useState(false);

  const normalizeId = (value) => {
    if (value === null || value === undefined) return value;
    return String(value);
  };

  const normalizeChannels = (rows) => {
    if (!Array.isArray(rows)) return [];
    return rows.map((ch) => ({
      ...ch,
      id: normalizeId(ch.id),
      parent_id: normalizeId(ch.parent_id)
    }));
  };

  const normalizeRoles = (rows) => {
    if (!Array.isArray(rows)) return [];
    return rows.map((role) => ({
      ...role,
      id: normalizeId(role.id)
    }));
  };

  useEffect(() => {
    if (guildId) {
      localStorage.setItem('selectedGuildId', guildId);
      if (user) refreshGuildData();
    }
  }, [guildId, user]);

  const refreshGuildData = async () => {
    if (!guildId) return;
    setLoading(true);
    try {
      const [channelsRes, rolesRes, botMemberRes] = await Promise.allSettled([
        axios.get(`/api/discord/guild/${guildId}/channels`),
        axios.get(`/api/discord/guild/${guildId}/roles`),
        axios.get(`/api/discord/guild/${guildId}/bot-member`)
      ]);

      if (channelsRes.status === 'fulfilled') setChannels(normalizeChannels(channelsRes.value.data));
      if (rolesRes.status === 'fulfilled') setRoles(normalizeRoles(rolesRes.value.data));
      if (botMemberRes.status === 'fulfilled') setBotMember(botMemberRes.value.data);
      
    } catch (error) {
      console.error("Failed to fetch guild data", error);
    } finally {
      setLoading(false);
    }
  };

  const getBotHighestRolePosition = () => {
    if (!botMember || !botMember.roles || !roles.length) return null;
    const botRoleIds = botMember.roles;
    let maxPos = -1;
    for (const roleId of botRoleIds) {
      const role = roles.find(r => String(r.id) === String(roleId));
      if (role && role.position > maxPos) {
        maxPos = role.position;
      }
    }
    return maxPos >= 0 ? maxPos : null;
  };

  return (
    <GuildContext.Provider value={{
      guildId, setGuildId, channels, roles, botMember,
      loading, refreshGuildData,
      botHighestRolePosition: getBotHighestRolePosition()
    }}>
      {children}
    </GuildContext.Provider>
  );
};

export const useGuild = () => useContext(GuildContext);
