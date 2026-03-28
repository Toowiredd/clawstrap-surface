'use client'

import { ClawstrapTopologyPanel } from '@/components/panels/clawstrap-topology-panel'
import type { DashboardData } from '../widget-primitives'

export function TopologyWidget(_props: { data: DashboardData }) {
  return (
    <div className="h-[500px] rounded-lg border border-border bg-card overflow-hidden">
      <ClawstrapTopologyPanel />
    </div>
  )
}
