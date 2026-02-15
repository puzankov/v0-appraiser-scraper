/**
 * Select component
 */

import React from 'react'

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: { value: string; label: string }[]
}

export function Select({ label, error, options, className = '', ...props }: SelectProps) {
  const baseClasses = 'block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white !text-gray-900'
  const errorClasses = error ? 'border-red-500' : 'border-gray-300'
  const classes = `${baseClasses} ${errorClasses} ${className}`

  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-gray-900 mb-1">
          {label}
        </label>
      )}
      {options.length === 0 ? (
        <div className="px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500 text-sm">
          No options available
        </div>
      ) : (
        <select className={classes} {...props}>
          {options.map((option) => (
            <option key={option.value} value={option.value} className="text-gray-900 bg-white">
              {option.label}
            </option>
          ))}
        </select>
      )}
      {error && (
        <p className="mt-1 text-sm text-red-600">{error}</p>
      )}
    </div>
  )
}
