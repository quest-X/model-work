import {EditorContext} from '../EditorContext';
import {AutoSaveService} from '../../../services/AutoSaveService';

describe('EditorContext save shortcuts', () => {
    it.each([
        ['Control', 's'],
        ['Meta', 's'],
    ])('force-saves with %s+S', (...keyCombo) => {
        const save = jest.spyOn(AutoSaveService, 'saveCurrentState').mockResolvedValue();
        const preventDefault = jest.fn();
        const shortcut = EditorContext.getActions().find(
            action => action.keyCombo.join('+') === keyCombo.join('+'),
        );

        expect(shortcut).toBeDefined();
        shortcut?.action({preventDefault} as unknown as KeyboardEvent);

        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledWith(true);
        save.mockRestore();
    });
});
