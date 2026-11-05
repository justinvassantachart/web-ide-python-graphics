/**
 * The Web IDE plugin. It contributes the Graphics panel and the Python helper
 * resource, and on activation registers one host-device opener (a
 * {@link DeviceMultiplexer}) while the session is idle, bridging the per-run
 * {@link GraphicsController} to the panel through the session-keyed registry.
 *
 * `createPythonGraphicsPlugin()` is the default graphics-only composition;
 * `createAdditionalServices` injects host services on other channels so a host
 * can run graphics and an independent service over the single device.
 */

import type { IDEPlugin } from 'web-ide'
import { DeviceMultiplexer } from '../mux/multiplexer'
import type { HostService } from '../mux/service'
import type { GraphicsScheduler } from '../service/graphics-service'
import { GraphicsController } from './controller'
import { GraphicsPanel } from './GraphicsPanel'
import { controllerRegistry } from './registry'
import { createGraphicsResource } from './resources'

export interface PythonGraphicsPluginOptions {
  /** Panel contribution id (default `web-ide.python-graphics`). */
  panelId?: string
  /** Panel tab title (default `Graphics`). */
  panelTitle?: string
  /** Panel order among workbench panels (default 25). */
  panelOrder?: number
  /** Injected timer, for tests. */
  scheduler?: GraphicsScheduler
  /**
   * Factory invoked once per mount to create host services sharing the device
   * on channels other than graphics (channel 1). Each service must obey the
   * response-only discipline (see docs/INTEGRATION.md §0).
   */
  createAdditionalServices?: () => HostService[]
}

const PLUGIN_ID = 'web-ide.python-graphics.plugin'
const DEFAULT_PANEL_ID = 'web-ide.python-graphics'

export function createPythonGraphicsPlugin(
  options: PythonGraphicsPluginOptions = {},
): IDEPlugin {
  return {
    id: PLUGIN_ID,
    contributes: {
      resources: [createGraphicsResource()],
      panels: [
        {
          id: options.panelId ?? DEFAULT_PANEL_ID,
          title: options.panelTitle ?? 'Graphics',
          order: options.panelOrder ?? 25,
          component: GraphicsPanel,
        },
      ],
    },
    activate(context) {
      const session = context.runtime
      if (!session || typeof session.registerHostDevice !== 'function') {
        // Headless tooling or a runtime without a host device: the panel shows
        // its placeholder and Web IDE is otherwise unaffected.
        return () => {}
      }
      const controller = new GraphicsController(options.scheduler)
      const additional = options.createAdditionalServices?.() ?? []
      const multiplexer = new DeviceMultiplexer({
        services: [controller.hostService, ...additional],
        onFatal: () => session.stop(),
      })

      let registration: { dispose(): void }
      let closeActive: (() => void) | null = null
      try {
        registration = session.registerHostDevice((device) => {
          closeActive?.()
          const close = multiplexer.opener(device)
          closeActive = close
          return () => {
            close()
            if (closeActive === close) closeActive = null
          }
        })
      } catch (error) {
        console.error('[python-graphics] registerHostDevice failed', error)
        controller.dispose()
        return () => {}
      }

      controllerRegistry.set(session, controller)
      return () => {
        controllerRegistry.delete(session, controller)
        registration.dispose()
        // Registration disposal only affects future runs. Explicitly release
        // this active connection and stop its runtime to unblock guest reads.
        const close = closeActive
        closeActive = null
        close?.()
        if (close) session.stop()
        controller.dispose()
      }
    },
  }
}

/** The default graphics-only plugin. */
export const pythonGraphicsPlugin: IDEPlugin = createPythonGraphicsPlugin()
