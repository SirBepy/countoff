import { set, useStore } from '../lib/store'
import type { Project } from '../lib/types'
import SetupCuts from './SetupCuts'
import SetupBeats from './SetupBeats'
import SetupLyrics from './SetupLyrics'

const STEPS = ['cuts', 'beats', 'lyrics'] as const
type Step = (typeof STEPS)[number]

const STEP_LABEL: Record<Step, string> = {
  cuts: 'Cuts',
  beats: 'Beats',
  lyrics: 'Lyrics',
}

/**
 * The ordered shell around the three setup steps: which step is showing, Back/Next,
 * and the final step's exit to the sheet. All chrome lives here, never in a step -
 * a step only ever receives `{ project }`, same shape as the flat list it replaces.
 * The topbar picker (src/App.tsx) reaches every step directly too, so this never
 * gates re-entry - it only orders a fresh walkthrough.
 */
export default function SetupFlow({ project }: { project: Project }) {
  const setupStep = useStore((s) => s.setupStep)
  const index = STEPS.indexOf(setupStep)

  const goTo = (step: Step) => set({ setupStep: step }, false)
  const goToSheet = () => set({ view: 'sheet' }, false)

  return (
    <div className="setup-flow">
      <div className="setup-flow-head">
        <div className="setup-flow-steps">
          {STEPS.map((step, i) => (
            <button
              key={step}
              className={`setup-flow-step${step === setupStep ? ' on' : ''}${i < index ? ' done' : ''}`}
              onClick={() => goTo(step)}
            >
              <span className="setup-flow-step-num">{i + 1}</span>
              {STEP_LABEL[step]}
            </button>
          ))}
        </div>
        <div className="setup-flow-nav">
          {index > 0 && (
            <button className="ghost" onClick={() => goTo(STEPS[index - 1])}>
              <i className="ph ph-arrow-left i" /> Back
            </button>
          )}
          {index < STEPS.length - 1 ? (
            <button className="primary" onClick={() => goTo(STEPS[index + 1])}>
              Next <i className="ph ph-arrow-right i" />
            </button>
          ) : (
            <button className="primary" onClick={goToSheet}>
              Go to the sheet <i className="ph ph-check i" />
            </button>
          )}
        </div>
      </div>
      <div className="setup-flow-body">
        {setupStep === 'cuts' && <SetupCuts project={project} />}
        {setupStep === 'beats' && <SetupBeats project={project} />}
        {setupStep === 'lyrics' && <SetupLyrics project={project} />}
      </div>
    </div>
  )
}
