"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, RotateCcw } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { enUS } from "date-fns/locale"

interface Version {
  id: string
  title: string
  createdAt: string
}

interface Props {
  versionsApiUrl: string
  promptId: string
}

export function VersionHistory({ versionsApiUrl, promptId }: Props) {
  const [versions, setVersions] = useState<Version[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedContent, setExpandedContent] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    fetch(versionsApiUrl)
      .then(r => r.json())
      .then(setVersions)
      .finally(() => setLoading(false))
  }, [versionsApiUrl])

  async function fetchVersionContent(versionId: string) {
    const res = await fetch(`/api/prompt-versions/${versionId}`)
    const data = await res.json()
    setExpandedContent(data.content)
    setExpandedId(versionId)
  }

  async function restoreVersion(versionId: string) {
    setRestoring(true)
    try {
      const res = await fetch(`/api/prompt-versions/${versionId}/restore`, { method: "POST" })
      if (res.ok) {
        // Refresh the page to reflect restored content
        window.location.reload()
      }
    } finally {
      setRestoring(false)
    }
  }

  if (loading) return <Loader2 className="h-4 w-4 animate-spin" />

  if (versions.length === 0) {
    return <p className="text-xs text-muted-foreground">No previous versions.</p>
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground mb-2">{versions.length} saved version(s)</p>
      {versions.map((v) => (
        <div key={v.id} className="border rounded-md p-2">
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                if (expandedId === v.id) {
                  setExpandedId(null)
                  setExpandedContent(null)
                } else {
                  fetchVersionContent(v.id)
                }
              }}
              className="text-xs font-medium hover:underline text-left"
            >
              {v.title}
            </button>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">
                {formatDistanceToNow(new Date(v.createdAt), { addSuffix: true, locale: enUS })}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px]"
                onClick={() => restoreVersion(v.id)}
                disabled={restoring}
              >
                <RotateCcw className="h-3 w-3 mr-1" /> Restore
              </Button>
            </div>
          </div>
          {expandedId === v.id && expandedContent !== null && (
            <div className="mt-2 text-xs text-muted-foreground bg-muted/50 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap">
              {expandedContent.slice(0, 500)}
              {expandedContent.length > 500 ? "…" : ""}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
