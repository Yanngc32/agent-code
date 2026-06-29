import { type ComponentPropsWithoutRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Links must open in the system browser, not navigate the app frame. Forcing
// target=_blank routes the click through the main process' window-open handler
// (shell.openExternal), so the Electron renderer never navigates away.
const mdComponents = {
  a: (props: ComponentPropsWithoutRef<'a'>) => <a {...props} target="_blank" rel="noreferrer" />
}

/** Render text as GitHub-flavored Markdown (headings, lists, code, tables, …).
 *  Safe: react-markdown builds React nodes, no raw HTML. Shared by the chat
 *  (assistant answers) and the file preview (.md "Janela de Arquivo"). */
export function Markdown({ text }: { text: string }): JSX.Element {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
