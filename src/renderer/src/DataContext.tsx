import React, { createContext, useCallback, useContext, useState } from 'react'

interface DataContextValue {
  version: number
  bump: () => void
}

const DataContext = createContext<DataContextValue>({ version: 0, bump: () => {} })

export function DataProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])
  return <DataContext.Provider value={{ version, bump }}>{children}</DataContext.Provider>
}

export function useDataVersion(): DataContextValue {
  return useContext(DataContext)
}
