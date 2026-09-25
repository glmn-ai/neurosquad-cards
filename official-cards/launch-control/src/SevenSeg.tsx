// Seven-segment digits drawn as SVG (no font files, crisp at any zoom).
import { memo } from 'react'

const SEGMENTS = {
  a: '5,1 19,1 21,3 19,5 5,5 3,3',
  b: '21,4 23,6 23,19 21,21 19,19 19,6',
  c: '21,23 23,25 23,38 21,40 19,38 19,25',
  d: '5,39 19,39 21,41 19,43 5,43 3,41',
  e: '3,23 5,25 5,38 3,40 1,38 1,25',
  f: '3,4 5,6 5,19 3,21 1,19 1,6',
  g: '5,20 19,20 21,22 19,24 5,24 3,22'
} as const

type Seg = keyof typeof SEGMENTS

const DIGITS: Record<string, Seg[]> = {
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'g', 'e', 'd'],
  '3': ['a', 'b', 'g', 'c', 'd'],
  '4': ['f', 'g', 'b', 'c'],
  '5': ['a', 'f', 'g', 'c', 'd'],
  '6': ['a', 'f', 'g', 'e', 'c', 'd'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g'],
  '-': ['g'],
  ' ': []
}

const ALL = Object.keys(SEGMENTS) as Seg[]

const Digit = memo(function Digit({ char }: { char: string }): React.JSX.Element {
  const lit = new Set(DIGITS[char] ?? [])
  return (
    <svg className="seg-digit" viewBox="0 0 24 44" aria-hidden>
      {ALL.map((seg) => (
        <polygon key={seg} points={SEGMENTS[seg]} className={lit.has(seg) ? 'on' : 'off'} />
      ))}
    </svg>
  )
})

/** "01:12:30" → digits and blinking colons. The text is also given to screen readers. */
export function SevenSeg({ text, label }: { text: string; label: string }): React.JSX.Element {
  return (
    <span className="seg" role="timer" aria-label={label}>
      {[...text].map((char, i) =>
        char === ':' ? (
          <span key={i} className="seg-colon" aria-hidden>
            <i />
            <i />
          </span>
        ) : (
          <Digit key={i} char={char} />
        )
      )}
    </span>
  )
}
