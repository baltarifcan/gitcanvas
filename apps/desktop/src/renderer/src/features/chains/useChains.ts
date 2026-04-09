import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Chain } from '@gitcanvas/shared'
import { api } from '@renderer/lib/api'

export const chainsKey = ['chains'] as const

export function useChains() {
  return useQuery({
    queryKey: chainsKey,
    queryFn: () => api.chains.list(),
    // Chains rarely change; cache aggressively across the renderer.
    staleTime: 5 * 60_000,
  })
}

export function useCreateChain() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      name: string
      explorerUrlTemplate: string
      addressPattern?: string | null
    }) => api.chains.create(input),
    onSuccess: (chain) => {
      qc.setQueryData<Chain[]>(chainsKey, (prev) =>
        prev ? [...prev, chain].sort((a, b) => a.name.localeCompare(b.name)) : [chain],
      )
    },
  })
}

export function useUpdateChain() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      id: string
      patch: {
        name?: string
        explorerUrlTemplate?: string
        addressPattern?: string | null
      }
    }) => api.chains.update(input),
    onSuccess: (chain) => {
      qc.setQueryData<Chain[]>(chainsKey, (prev) =>
        prev
          ? prev
              .map((c) => (c.id === chain.id ? chain : c))
              .sort((a, b) => a.name.localeCompare(b.name))
          : [chain],
      )
    },
  })
}

/**
 * Default address validation regex used when a chain has no `addressPattern`
 * configured. Matches the standard EVM hex format (`0x` + 40 hex chars).
 * Most chains the user is likely to add are EVM-compatible.
 */
export const DEFAULT_ADDRESS_PATTERN = '^0x[a-fA-F0-9]{40}$'

/**
 * Returns a compiled RegExp for the chain's address format, falling back to
 * the EVM default if `addressPattern` is null. Returns null if the pattern
 * fails to compile (we don't want to block the form on bad regex stored in
 * the chain definition).
 */
export function getAddressRegex(chain: Chain | null | undefined): RegExp | null {
  const pattern = chain?.addressPattern ?? DEFAULT_ADDRESS_PATTERN
  try {
    return new RegExp(pattern)
  } catch {
    return null
  }
}

/** Find a chain by name (case-insensitive trim). */
export function findChainByName(
  chains: Chain[] | undefined,
  name: string,
): Chain | null {
  if (!chains) return null
  const normalized = name.trim().toLowerCase()
  return chains.find((c) => c.name.trim().toLowerCase() === normalized) ?? null
}

export function useDeleteChain() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.chains.delete({ id }),
    onSuccess: (_void, id) => {
      qc.setQueryData<Chain[]>(chainsKey, (prev) =>
        prev ? prev.filter((c) => c.id !== id) : [],
      )
    },
  })
}

/**
 * Build a clickable explorer URL for a (chain name, contract address) pair.
 * Returns null if the chain isn't configured — the UI should fall back to a
 * non-clickable address display in that case.
 */
export function buildExplorerUrl(
  chains: Chain[] | undefined,
  chainName: string,
  address: string,
): string | null {
  if (!chains) return null
  const normalized = chainName.trim().toLowerCase()
  const chain = chains.find((c) => c.name.trim().toLowerCase() === normalized)
  if (!chain) return null
  return chain.explorerUrlTemplate.replace('{address}', encodeURIComponent(address.trim()))
}
