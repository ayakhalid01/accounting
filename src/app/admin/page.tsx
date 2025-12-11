'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import { auth } from '@/lib/supabase/auth';
import { supabase } from '@/lib/supabase/client';
import { CheckCircle, XCircle, Clock, User, FileText, Calendar, DollarSign, Shield, AlertTriangle, Settings, UserPlus, Key } from 'lucide-react';

interface PendingDeduction {
  id: string;
  invoice_id: string;
  amount: number;
  reason: string;
  requested_by: string;
  requested_at: string;
  status: string;
  invoice?: any;
}

interface AuditLog {
  id: string;
  action: string;
  table_name: string;
  user_email: string;
  timestamp: string;
  details: any;
}

export default function AdminPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [pendingDeductions, setPendingDeductions] = useState<PendingDeduction[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [activeTab, setActiveTab] = useState<'users'>('users');
  const [processing, setProcessing] = useState<string | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<'user' | 'admin'>('user');

  useEffect(() => {
    const init = async () => {
      console.log('🛡️ [ADMIN] Checking authentication...');
      const { session } = await auth.getSession();
      
      if (!session) {
        console.log('❌ [ADMIN] No session, redirecting to login');
        router.push('/login');
        return;
      }

      console.log('✅ [ADMIN] Admin access granted:', session.user.email);
      
      await Promise.all([
        loadUsers(),
        loadPendingDeposits()
      ]);
      setLoading(false);
    };

    init();
  }, [router]);

  const loadUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUsers(data || []);
      console.log('✅ Loaded users:', data?.length);
    } catch (err: any) {
      console.error('❌ Error loading users:', err);
    }
  };

  const loadPendingDeposits = async () => {
    try {
      const { data, error } = await supabase
        .from('deposits')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;
      // Map deposits to pendingDeductions format for compatibility
      const mappedData = (data || []).map(deposit => ({
        id: deposit.id,
        invoice_id: deposit.id,
        amount: deposit.net_amount,
        reason: 'Pending deposit approval',
        requested_by: deposit.imported_by || 'system',
        requested_at: deposit.created_at,
        status: 'pending',
        invoice: deposit
      }));
      setPendingDeductions(mappedData);
      console.log('✅ Loaded pending deposits:', mappedData.length);
    } catch (err: any) {
      console.error('❌ Error loading pending deposits:', err);
    }
  };

  const handleAddUser = async () => {
    try {
      if (!newUserEmail || !newUserPassword) {
        alert('Please enter email and password');
        return;
      }

      const { session } = await auth.getSession();
      if (!session?.user) {
        alert('You must be logged in to add users');
        return;
      }

      setProcessing('adding-user');

      // Call server-side API to create user with admin privileges
      const response = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: newUserEmail,
          password: newUserPassword,
          role: newUserRole,
          fullName: newUserEmail.split('@')[0]
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create user');
      }

      alert(
        `✅ User created successfully!\n\n` +
        `Email: ${newUserEmail}\n` +
        `Role: ${newUserRole}\n\n` +
        `The user can now log in immediately without email confirmation.`
      );
      
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserRole('user');
      await loadUsers();
    } catch (err: any) {
      console.error('User creation error:', err);
      alert('Failed to add user: ' + err.message);
    } finally {
      setProcessing(null);
    }
  };

  const handleToggleUserStatus = async (userId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ is_active: !currentStatus })
        .eq('id', userId);

      if (error) throw error;
      await loadUsers();
    } catch (err: any) {
      alert('Failed to update user status: ' + err.message);
    }
  };

  const handleChangeRole = async (userId: string, newRole: 'user' | 'admin') => {
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ role: newRole === 'admin' ? 'admin' : 'accountant' })
        .eq('id', userId);

      if (error) throw error;
      await loadUsers();
    } catch (err: any) {
      alert('Failed to update user role: ' + err.message);
    }
  };

  const handleDeleteUser = async (userId: string, userEmail: string) => {
    if (!confirm(`Are you sure you want to delete user: ${userEmail}?\n\nThis action cannot be undone.`)) {
      return;
    }

    try {
      setProcessing(`deleting-${userId}`);

      // Call API to delete user (requires admin privileges)
      const response = await fetch('/api/admin/delete-user', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      alert('User deleted successfully!');
      await loadUsers();
    } catch (err: any) {
      alert('Failed to delete user: ' + err.message);
    } finally {
      setProcessing(null);
    }
  };

  if (loading) {
    return (
      <div>
        <Navigation />
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-primary-500 border-r-transparent"></div>
            <p className="mt-4 text-gray-600">Loading admin panel...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3">
            <Shield className="h-8 w-8 text-primary-600" />
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Admin Panel</h1>
              <p className="text-gray-600 mt-1">Manage approvals and system oversight</p>
            </div>
          </div>
        </div>

        {/* Stats Overview */}
        <div className="mb-8">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 max-w-md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Pending Approvals</p>
                <p className="text-3xl font-bold text-yellow-600 mt-1">
                  {pendingDeductions.length}
                </p>
                <p className="text-xs text-gray-500 mt-1">Deposits awaiting approval</p>
              </div>
              <Clock className="h-12 w-12 text-yellow-600 opacity-20" />
            </div>
          </div>
        </div>

        {/* User Management Section */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px">
              <div className="px-6 py-3 text-sm font-medium border-b-2 border-primary-600 text-primary-600">
                <User className="inline h-4 w-4 mr-2" />
                User Management
              </div>
            </nav>
          </div>

          <div className="p-6">
            {/* User Management Section */}
            <div className="space-y-6">\
                
                {/* Add User Form */}
                <div className="border border-gray-200 rounded-lg p-6 bg-gray-50">
                  <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
                    <UserPlus className="h-5 w-5 text-primary-600" />
                    Add New User
                  </h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">Email Address</label>
                      <input 
                        type="email" 
                        value={newUserEmail}
                        onChange={(e) => setNewUserEmail(e.target.value)}
                        placeholder="user@example.com"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" 
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">Password</label>
                      <input 
                        type="password" 
                        value={newUserPassword}
                        onChange={(e) => setNewUserPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" 
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">Role</label>
                      <select 
                        value={newUserRole}
                        onChange={(e) => setNewUserRole(e.target.value as 'user' | 'admin')}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                  </div>
                  <button 
                    onClick={handleAddUser}
                    disabled={processing === 'adding-user'}
                    className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <UserPlus className="h-4 w-4" />
                    {processing === 'adding-user' ? 'Adding...' : 'Add User'}
                  </button>
                </div>

                {/* Users List */}
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {users.map((user) => (
                        <tr key={user.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 text-sm font-medium text-gray-900">{user.email}</td>
                          <td className="px-6 py-4 text-sm">
                            <select
                              value={user.role || 'user'}
                              onChange={(e) => handleChangeRole(user.id, e.target.value as 'user' | 'admin')}
                              className="px-2 py-1 text-xs border border-gray-300 rounded"
                            >
                              <option value="user">User</option>
                              <option value="admin">Admin</option>
                            </select>
                          </td>
                          <td className="px-6 py-4 text-sm">
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                              user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                            }`}>
                              {user.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-500">
                            {new Date(user.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4 text-sm text-right">
                            <div className="flex gap-2 justify-end">
                              <button
                                onClick={() => handleToggleUserStatus(user.id, user.is_active)}
                                disabled={processing === `deleting-${user.id}`}
                                className={`px-3 py-1 rounded text-xs font-medium ${
                                  user.is_active 
                                    ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' 
                                    : 'bg-green-100 text-green-700 hover:bg-green-200'
                                }`}
                              >
                                {user.is_active ? 'Deactivate' : 'Activate'}
                              </button>
                              <button
                                onClick={() => handleDeleteUser(user.id, user.email)}
                                disabled={processing === `deleting-${user.id}`}
                                className="px-3 py-1 rounded text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50"
                              >
                                {processing === `deleting-${user.id}` ? 'Deleting...' : 'Delete'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            
          </div>
        </div>
      </main>
    </div>
  );
}
