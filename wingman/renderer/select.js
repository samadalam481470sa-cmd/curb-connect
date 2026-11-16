const shot = document.getElementById('shot')
const shade = document.getElementById('shade')
const rect = document.getElementById('rect')
const hint = document.getElementById('hint')

let start = null

window.selector.onImage((url) => {
  shot.src = url
})

function bounds(a, b) {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
}

function toNormalized(a, b) {
  const area = bounds(a, b)
  return {
    x: area.left / window.innerWidth,
    y: area.top / window.innerHeight,
    w: area.width / window.innerWidth,
    h: area.height / window.innerHeight,
  }
}

document.addEventListener('mousedown', (event) => {
  if (event.button !== 0) {
    window.selector.cancel()
    return
  }
  start = { x: event.clientX, y: event.clientY }
  shade.hidden = true
  rect.hidden = false
  rect.style.left = `${event.clientX}px`
  rect.style.top = `${event.clientY}px`
  rect.style.width = '0px'
  rect.style.height = '0px'
})

document.addEventListener('mousemove', (event) => {
  if (!start) return

  const area = bounds(start, { x: event.clientX, y: event.clientY })
  rect.style.left = `${area.left}px`
  rect.style.top = `${area.top}px`
  rect.style.width = `${area.width}px`
  rect.style.height = `${area.height}px`
  hint.textContent = `${Math.round(area.width)} × ${Math.round(area.height)} · release to ask · Esc cancels`
})

document.addEventListener('mouseup', (event) => {
  if (!start) return

  const region = toNormalized(start, { x: event.clientX, y: event.clientY })
  start = null

  // A click without a drag is a cancel, not a one-pixel question.
  if (region.w < 0.02 || region.h < 0.02) {
    window.selector.cancel()
    return
  }
  window.selector.done(region)
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.selector.cancel()
})

document.addEventListener('contextmenu', (event) => {
  event.preventDefault()
  window.selector.cancel()
})
