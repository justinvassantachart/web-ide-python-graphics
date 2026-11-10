import { useId } from 'react'
import type { ControlDescriptor, ControlValue } from '../model/controls'
import type { GraphicsInput } from '../service/events'

/** Native accessible controls; keyboard input never bubbles into game controls. */
export function GraphicsControls({ controls, onInput }: { controls: readonly ControlDescriptor[]; onInput?: (event: GraphicsInput) => void }) {
  const prefix = useId()
  const emit = (control: ControlDescriptor, kind: 'controlchange' | 'controlsubmit' | 'controlclick', value: ControlValue) => onInput?.({ kind, controlId: control.id, value })
  return <div data-python-graphics-controls="" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: 12, color: 'var(--color-foreground, #ddd)', font: '13px system-ui' }}
    onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
    {controls.map(control => {
      const id = `${prefix}-${control.id}`
      if (control.kind === 'button') return <button key={control.id} type="button" onClick={() => emit(control, 'controlclick', control.value)}>{control.label}</button>
      if (control.kind === 'choice') return <fieldset key={control.id} style={{ display: 'flex', gap: 8 }}><legend>{control.label}</legend>{control.options?.map(option => <label key={option}><input type="radio" name={id} checked={control.value === option} onChange={() => emit(control, 'controlchange', option)} />{option}</label>)}</fieldset>
      return <label key={control.id} htmlFor={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {control.label}
        {control.kind === 'checkbox' ? <input id={id} type="checkbox" checked={control.value as boolean} onChange={event => emit(control, 'controlchange', event.currentTarget.checked)} />
          : control.kind === 'slider' ? <><input id={id} type="range" min={control.min} max={control.max} step={1} value={control.value as number} onChange={event => emit(control, 'controlchange', Number(event.currentTarget.value))} /><output htmlFor={id}>{control.value}</output></>
            : <input id={id} type="text" maxLength={4096} value={control.value as string} onChange={event => emit(control, 'controlchange', event.currentTarget.value)} onKeyDown={event => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) emit(control, 'controlsubmit', event.currentTarget.value)
            }} />}
      </label>
    })}
  </div>
}
