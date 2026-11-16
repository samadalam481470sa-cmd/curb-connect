const api = window.wingman

const log = document.getElementById('log')
const empty = document.getElementById('empty')
const input = document.getElementById('input')
const askButton = document.getElementById('ask')
const screenButton = document.getElementById('screen')
const regionButton = document.getElementById('region')
const clearButton = document.getElementById('clear')
const hideButton = document.getElementById('hide')
const quitButton = document.getElementById('quit')
const statusLine = document.getElementById('status')
const providerLine = document.getElementById('provider')

const DEFAULT_QUESTION = {
  screen: 'Answer the question shown on screen.',
  region: 'Answer the question in the selected area.',
}

let active = null
let pendingRows = []

function nextId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
}

function scrollToBottom() {
  log.scrollTop = log.scrollHeight
}

function setStreaming(on) {
  askButton.textContent = on ? 'Stop' : 'Ask'
  askButton.classList.toggle('ask--stop', on)
  askButton.dataset.action = on ? 'stop' : 'ask'
}

function addBubble(role, text) {
  empty.style.display = 'none'

  const row = document.createElement('div')
  row.className = `row row--${role}`

  const label = document.createElement('div')
  label.className = 'label'
  label.textContent = role === 'user' ? 'You' : 'Wingman'

  const body = document.createElement('div')
  body.className = 'body'
  const textNode = document.createTextNode(text)
  body.append(textNode)

  let caret = null
  if (role === 'assistant') {
    caret = document.createElement('span')
    caret.className = 'caret'
    body.append(caret)
  }

  row.append(label, body)
  log.append(row)
  scrollToBottom()

  return { row, textNode, caret }
}

function addNotice(text, withSettings = false) {
  empty.style.display = 'none'

  const row = document.createElement('div')
  row.className = 'notice'
  row.append(document.createTextNode(text))

  if (withSettings) {
    const button = document.createElement('button')
    button.className = 'notice__action'
    button.textContent = 'Open System Settings'
    button.addEventListener('click', () => api.screenSettings())
    row.append(button)
  }

  log.append(row)
  scrollToBottom()
  return row
}

function finishActive(note) {
  if (!active) return
  active.caret?.remove()
  if (note) active.textNode.appendData(active.textNode.length ? `\n\n${note}` : note)
  active = null
  setStreaming(false)
  scrollToBottom()
}

function discardPending() {
  pendingRows.forEach((row) => row.remove())
  pendingRows = []
  active = null
  setStreaming(false)
}

function reportFailure(reason) {
  discardPending()
  statusLine.textContent = ''

  if (reason === 'cancelled') return

  if (reason === 'screen-permission') {
    addNotice(
      'Screen Recording permission is off, so Wingman cannot read your display. Enable it in System Settings → Privacy & Security → Screen & System Audio Recording, then relaunch Wingman.',
      true,
    )
    return
  }

  if (reason === 'capture-failed') {
    addNotice('Capturing this display failed. Try again, or ask without the screen.')
    return
  }

  addNotice('The assistant could not start. Check the provider settings in wingman/.env.')
}

async function ask(text, mode = 'text') {
  const question = (text ?? input.value).trim()
  if (!question && mode === 'text') return

  // A new question abandons the previous stream, so answers never interleave.
  api.cancel()
  finishActive()

  input.value = ''
  autosize()

  const id = nextId()
  const asked = question || DEFAULT_QUESTION[mode]
  const userBubble = addBubble('user', mode === 'text' ? asked : `${asked}\n[${mode}]`)
  const answerBubble = addBubble('assistant', '')
  pendingRows = [userBubble.row, answerBubble.row]
  active = {
    id,
    textNode: answerBubble.textNode,
    caret: answerBubble.caret,
    startedAt: performance.now(),
    firstTokenAt: 0,
  }
  setStreaming(true)

  statusLine.textContent =
    mode === 'text' ? 'thinking…' : mode === 'region' ? 'drag to select an area · Esc cancels' : 'reading the screen…'

  try {
    const result =
      mode === 'region'
        ? await api.askRegion(asked, id)
        : mode === 'screen'
          ? await api.ask(asked, true, id)
          : await api.ask(asked, false, id)

    if (!result || result.ok !== true) {
      reportFailure(result?.reason)
      return
    }
    pendingRows = []
  } catch (error) {
    if (!active || active.id !== id) return
    pendingRows = []
    finishActive(`⚠ ${error?.message ?? error}`)
    statusLine.textContent = ''
  }
}

function stopStream() {
  api.cancel()
  if (active) statusLine.textContent = 'stopping…'
}

function autosize() {
  input.style.height = 'auto'
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`
}

api.onChunk((payload) => {
  if (!active || payload?.id !== active.id) return
  if (!active.firstTokenAt) active.firstTokenAt = performance.now()
  active.textNode.appendData(payload.text ?? '')
  scrollToBottom()
})

api.onDone((payload) => {
  if (!active || payload?.id !== active.id) return
  const first = active.firstTokenAt ? Math.round(active.firstTokenAt - active.startedAt) : payload.firstTokenMs
  const total = Math.round(performance.now() - active.startedAt)
  finishActive()

  if (payload.stopped) {
    statusLine.textContent = `stopped after ${(total / 1000).toFixed(2)}s`
    return
  }
  const local = payload.fallback ? ' · local model' : ''
  statusLine.textContent = `answered in ${(total / 1000).toFixed(2)}s · first token ${first || total}ms${local}`
})

api.onError((payload) => {
  if (!active || payload?.id !== active.id) return
  pendingRows = []
  finishActive(`⚠ ${payload.message}`)
  statusLine.textContent = ''
})

api.onNotice((payload) => {
  if (payload?.id && active && payload.id !== active.id) return
  addNotice(payload?.message ?? 'Notice')
})

api.onAskScreenshot(() => ask(input.value, 'screen'))
api.onAskRegion(() => ask(input.value, 'region'))

api.onAskClipboard((payload) => {
  const text = (payload?.text ?? '').trim()
  if (!text) {
    addNotice('Nothing to answer — the clipboard has no text.')
    return
  }
  if (payload.truncated) {
    addNotice(
      `Clipboard text was ${payload.originalLength.toLocaleString()} characters long; only the first ${text.length.toLocaleString()} were sent.`,
    )
  }
  ask(text, 'text')
})

// Activation lives in the main process; this only puts the caret in the field.
api.onFocusInput(() => input.focus())

api.describeProvider().then((description) => {
  providerLine.textContent = description
})

api.capabilities().then((capabilities) => {
  if (capabilities?.screenPermission === 'denied') {
    addNotice(
      'Screen Recording permission is off, so screen questions cannot read your display. Enable Wingman in System Settings → Privacy & Security → Screen & System Audio Recording, then relaunch.',
      true,
    )
  }
})

askButton.addEventListener('click', () => {
  if (askButton.dataset.action === 'stop') stopStream()
  else ask()
})
screenButton.addEventListener('click', () => ask(input.value, 'screen'))
regionButton.addEventListener('click', () => ask(input.value, 'region'))
hideButton.addEventListener('click', () => api.hide())
quitButton.addEventListener('click', () => api.quit())

input.addEventListener('input', autosize)
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    ask()
  }
})

clearButton.addEventListener('click', () => {
  api.cancel()
  active = null
  pendingRows = []
  setStreaming(false)
  log.querySelectorAll('.row, .notice').forEach((row) => row.remove())
  empty.style.display = ''
  statusLine.textContent = ''
})

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') api.hide()
})

setStreaming(false)
autosize()
input.focus()
