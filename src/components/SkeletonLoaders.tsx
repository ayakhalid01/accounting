import React from 'react';

// Skeleton for Stat Cards
export function StatCardSkeleton() {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="h-4 bg-gray-200 rounded w-24 mb-3"></div>
          <div className="h-8 bg-gray-200 rounded w-32 mb-2"></div>
          <div className="h-3 bg-gray-200 rounded w-28"></div>
        </div>
        <div className="w-12 h-12 bg-gray-200 rounded-lg"></div>
      </div>
    </div>
  );
}

// Skeleton for Table Rows
export function TableRowSkeleton({ columns = 7 }: { columns?: number }) {
  return (
    <tr className="animate-pulse">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-6 py-4">
          <div className="h-4 bg-gray-200 rounded w-full"></div>
        </td>
      ))}
    </tr>
  );
}

// Skeleton for Full Table
export function TableSkeleton({ 
  rows = 5, 
  columns = 7,
  headers = []
}: { 
  rows?: number; 
  columns?: number;
  headers?: string[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        {headers.length > 0 && (
          <thead className="bg-gray-50">
            <tr>
              {headers.map((header, i) => (
                <th
                  key={i}
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody className="bg-white divide-y divide-gray-200">
          {Array.from({ length: rows }).map((_, i) => (
            <TableRowSkeleton key={i} columns={columns} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Skeleton for Chart
export function ChartSkeleton() {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 animate-pulse">
      <div className="h-6 bg-gray-200 rounded w-48 mb-4"></div>
      <div className="space-y-3">
        <div className="flex items-end space-x-2 h-64">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 bg-gray-200 rounded-t"
              style={{ height: `${Math.random() * 60 + 40}%` }}
            ></div>
          ))}
        </div>
        <div className="flex justify-between">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-3 bg-gray-200 rounded w-12"></div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Loading Badge Overlay for existing content
export function LoadingBadge({ text = 'Updating...' }: { text?: string }) {
  return (
    <div className="absolute top-2 right-2 z-10">
      <div className="flex items-center space-x-2 bg-blue-500 text-white px-3 py-1 rounded-full text-xs font-medium shadow-lg">
        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
        <span>{text}</span>
      </div>
    </div>
  );
}

// Wrapper for content with loading state
export function LoadingWrapper({ 
  isLoading, 
  children,
  loadingText = 'Loading...',
  showOldData = false
}: { 
  isLoading: boolean; 
  children: React.ReactNode;
  loadingText?: string;
  showOldData?: boolean;
}) {
  return (
    <div className="relative">
      {isLoading && showOldData && <LoadingBadge text={loadingText} />}
      <div className={isLoading && showOldData ? 'opacity-50 pointer-events-none' : ''}>
        {children}
      </div>
    </div>
  );
}
