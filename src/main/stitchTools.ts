import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { BrowserController } from './browserController'

type Text = { content: { type: 'text'; text: string }[] }
const text = (t: string): Text => ({ content: [{ type: 'text', text: t }] })

/**
 * In-process MCP server that bridges Google Stitch designs into the embedded
 * preview. The remote Stitch MCP (`mcp__stitch__*`) generates designs and returns
 * their HTML; this server renders that HTML in a dedicated "stitch" preview tab so
 * the user can visually review and approve it (Aplicar/Descartar) before the agent
 * implements it into the project.
 */
export function createStitchPreviewMcpServer(
  browser: BrowserController
): ReturnType<typeof createSdkMcpServer> {
  return createSdkMcpServer({
    name: 'stitchpreview',
    version: '1.0.0',
    tools: [
      tool(
        'show_stitch_design',
        'Display a Google Stitch design in a dedicated "stitch" preview tab so the user can visually review and approve it. Pass the full screen HTML you obtained from the Stitch tool fetch_screen_code. After calling this, STOP and ask the user to review: they approve with "Aplicar no projeto" or reject with "Descartar" on the tab. Do NOT write the design into the project until the user approves.',
        {
          html: z
            .string()
            .describe('Full HTML of the Stitch screen to render in the preview (from fetch_screen_code).'),
          title: z
            .string()
            .optional()
            .describe('Short label for the preview tab, e.g. the screen name ("Tela de login").')
        },
        async ({ html, title }) => text(await browser.showStitchDesign(html, title))
      )
    ]
  })
}
