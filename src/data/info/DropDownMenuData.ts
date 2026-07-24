import {updateActivePopupType} from '../../store/general/actionCreators';
import {PopupWindowType} from '../enums/PopupWindowType';
import {store} from '../../index';
import {Language, LanguageConfig} from '../LanguageConfig';

export type DropDownMenuNode = {
    name: string
    description?: string
    imageSrc: string
    imageAlt: string
    disabled: boolean
    divider?: boolean
    onClick?: () => void
    children?: DropDownMenuNode[]
}

export const getDropDownMenuData = (language: Language): DropDownMenuNode[] => {
    const texts = LanguageConfig[language];
    
    return [
        {
            name: texts.actions.title,
            imageSrc: 'ico/actions.png',
            imageAlt: 'actions',
            disabled: false,
            children: [
                {
                    name: texts.actions.integrateAIModel.name,
                    description: texts.actions.integrateAIModel.description,
                    imageSrc: 'ico/api.png',
                    imageAlt: 'remote-models',
                    disabled: false,
                    divider: true,
                    onClick: () => {
                        const hasRegisteredEngines = store.getState().aimodels.models.length > 0;
                        store.dispatch(updateActivePopupType(hasRegisteredEngines ? PopupWindowType.MANAGE_AI_MODELS : PopupWindowType.MODEL_ENGINE));
                    }
                },
                {
                    name: texts.actions.uploadFiles.name,
                    description: texts.actions.uploadFiles.description,
                    imageSrc: 'ico/camera.png',
                    imageAlt: 'upload',
                    disabled: false,
                    onClick: () => store.dispatch(updateActivePopupType(PopupWindowType.IMPORT_IMAGES))
                },
                {
                    name: texts.actions.editLabels.name,
                    description: texts.actions.editLabels.description,
                    imageSrc: 'ico/tags.png',
                    imageAlt: 'labels',
                    disabled: false,
                    onClick: () => store.dispatch(updateActivePopupType(PopupWindowType.UPDATE_LABEL))
                },
                {
                    name: texts.actions.importAnnotations.name,
                    description: texts.actions.importAnnotations.description,
                    imageSrc: 'ico/import-labels.png',
                    imageAlt: 'import-labels',
                    disabled: false,
                    onClick: () => store.dispatch(updateActivePopupType(PopupWindowType.IMPORT_ANNOTATIONS))
                },
                {
                    name: texts.actions.exportAnnotations.name,
                    description: texts.actions.exportAnnotations.description,
                    imageSrc: 'ico/export-labels.png',
                    imageAlt: 'export-labels',
                    disabled: false,
                    onClick: () => store.dispatch(updateActivePopupType(PopupWindowType.EXPORT_ANNOTATIONS))
                },
            ]
        }
        // Community 部分已移除
    ];
};

// 保持向后兼容性，默认使用英文
export const DropDownMenuData: DropDownMenuNode[] = getDropDownMenuData(Language.ENGLISH);
