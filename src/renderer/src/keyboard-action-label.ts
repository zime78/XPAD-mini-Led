import type { KeyboardAction, KeyboardKeyCode } from '../../shared/types';

export function keyboardActionLabel(action: KeyboardAction): string {
  if (action.type === 'key') return keyboardKeyCodeLabel(action.keyCode);
  if (action.type === 'launch-app') return `${action.appName} 실행`;
  return '미지원';
}

export function compactKeyboardActionLabel(action: KeyboardAction): string {
  if (action.type === 'launch-app') return action.appName;
  return keyboardActionLabel(action);
}

export function keyboardKeyCodeLabel(keyCode: KeyboardKeyCode): string {
  if (keyCode.startsWith('Key')) return keyCode.slice(3);
  if (keyCode.startsWith('Digit')) return keyCode.slice(5);
  if (/^F\d+$/.test(keyCode)) return keyCode;
  const labels: Partial<Record<KeyboardKeyCode, string>> = {
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Backquote: '`',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Space: 'Space',
    Enter: 'Enter',
    Tab: 'Tab',
    Escape: 'Esc',
    Backspace: 'Backspace',
    Delete: 'Delete',
    CapsLock: 'Caps Lock',
    ArrowUp: '↑ 방향키',
    ArrowDown: '↓ 방향키',
    ArrowLeft: '← 방향키',
    ArrowRight: '→ 방향키',
    Home: 'Home',
    End: 'End',
    PageUp: 'Page Up',
    PageDown: 'Page Down',
    MediaTrackPrevious: '이전 곡',
    MediaPlayPause: '재생/일시정지',
    MediaTrackNext: '다음 곡',
  };
  return labels[keyCode] ?? keyCode;
}
