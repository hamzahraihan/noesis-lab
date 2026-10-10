import { beforeEach, describe, expect, it } from 'vitest';
import { useFirmwareEditorStore } from './editor-store';

beforeEach(() => {
  useFirmwareEditorStore.setState(
    {
      notice: null,
      libsPopupOpen: false,
      slotId: null,
      slotPath: null,
      browseOpen: false,
      indexLibs: null,
      indexLoading: false,
      query: '',
      debouncedQuery: '',
      category: 'all',
      selectedName: null,
      pinnedVersion: null,
      installing: null,
      installedIndex: new Map(),
    },
  );
});

describe('useFirmwareEditorStore', () => {
  it('toggles the libraries popup and browse', () => {
    const s = useFirmwareEditorStore.getState();
    s.toggleLibsPopup();
    s.toggleBrowse();
    expect(useFirmwareEditorStore.getState()).toMatchObject({ libsPopupOpen: true, browseOpen: true });
  });

  it('picks a slot file in one update', () => {
    useFirmwareEditorStore.getState().pickSlotFile('MyLib', 'MyLib.h');
    expect(useFirmwareEditorStore.getState()).toMatchObject({ slotId: 'MyLib', slotPath: 'MyLib.h' });
  });

  it('merges restored builds without clobbering session installs', () => {
    const s = useFirmwareEditorStore.getState();
    s.setInstalled('Servo', { version: '1.0.0', headers: ['Servo.h'] });
    s.mergeInstalled(
      new Map([
        ['Servo', { version: '0.0.1', headers: ['Servo.h'] }],
        ['Wire', { version: '2.0.0', headers: ['Wire.h'] }],
      ]),
    );
    expect(useFirmwareEditorStore.getState().installedIndex.get('Servo')?.version).toBe('1.0.0');
    expect(useFirmwareEditorStore.getState().installedIndex.get('Wire')?.version).toBe('2.0.0');
    s.removeInstalled('Wire');
    expect(useFirmwareEditorStore.getState().installedIndex.has('Wire')).toBe(false);
  });
});
