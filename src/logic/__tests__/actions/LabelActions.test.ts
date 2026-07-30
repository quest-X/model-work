import { LabelActions } from '../../actions/LabelActions';
import { store } from '../../../index';
import { updateLabelNames } from '../../../store/labels/actionCreators';
import { updateSegmentationResults } from '../../../store/ai/actionCreators';
import { LabelUtil } from '../../../utils/LabelUtil';
import { SegmentationResult } from '../../../ai/SegmentationAPIDetector';

describe('LabelActions', () => {
    describe('removeLabelNames', () => {
        it('should remove corresponding segmentation results when labels are deleted', () => {
            // 创建测试用的标签
            const testLabel1 = LabelUtil.createLabelName('person');
            const testLabel2 = LabelUtil.createLabelName('car');
            const testLabel3 = LabelUtil.createLabelName('bike');
            
            // 设置初始标签状态
            store.dispatch(updateLabelNames([testLabel1, testLabel2, testLabel3]));
            
            // 创建测试用的分割结果
            const segmentationResults: SegmentationResult[] = [
                {
                    class_id: 1,
                    class_name: 'person',
                    confidence: 0.9,
                    bbox: { x1: 10, y1: 10, x2: 50, y2: 50, width: 40, height: 40 },
                    mask: { mask_data: [], area: 1600 }
                },
                {
                    class_id: 2,
                    class_name: 'car',
                    confidence: 0.8,
                    bbox: { x1: 60, y1: 60, x2: 100, y2: 100, width: 40, height: 40 },
                    mask: { mask_data: [], area: 1600 }
                },
                {
                    class_id: 3,
                    class_name: 'bike',
                    confidence: 0.7,
                    bbox: { x1: 110, y1: 110, x2: 150, y2: 150, width: 40, height: 40 },
                    mask: { mask_data: [], area: 1600 }
                }
            ];
            
            // 设置初始分割结果状态
            store.dispatch(updateSegmentationResults(segmentationResults));
            
            // 验证初始状态
            expect(store.getState().ai.segmentationResults).toHaveLength(3);
            
            // 删除 'person' 和 'car' 标签
            LabelActions.removeLabelNames([testLabel1.id, testLabel2.id]);
            
            // 验证对应的分割结果也被删除
            const remainingResults = store.getState().ai.segmentationResults;
            expect(remainingResults).toHaveLength(1);
            expect(remainingResults[0].class_name).toBe('bike');
        });
        
        it('should handle case insensitive matching', () => {
            // 创建测试用的标签
            const testLabel = LabelUtil.createLabelName('Person');
            
            // 设置初始标签状态
            store.dispatch(updateLabelNames([testLabel]));
            
            // 创建测试用的分割结果（不同大小写）
            const segmentationResults: SegmentationResult[] = [
                {
                    class_id: 1,
                    class_name: 'person', // 小写
                    confidence: 0.9,
                    bbox: { x1: 10, y1: 10, x2: 50, y2: 50, width: 40, height: 40 },
                    mask: { mask_data: [], area: 1600 }
                }
            ];
            
            // 设置初始分割结果状态
            store.dispatch(updateSegmentationResults(segmentationResults));
            
            // 验证初始状态
            expect(store.getState().ai.segmentationResults).toHaveLength(1);
            
            // 删除标签
            LabelActions.removeLabelNames([testLabel.id]);
            
            // 验证对应的分割结果也被删除（即使大小写不同）
            expect(store.getState().ai.segmentationResults).toHaveLength(0);
        });
        
        it('should not remove segmentation results if no matching labels are deleted', () => {
            // 创建测试用的标签
            const testLabel1 = LabelUtil.createLabelName('person');
            const testLabel2 = LabelUtil.createLabelName('car');
            
            // 设置初始标签状态
            store.dispatch(updateLabelNames([testLabel1, testLabel2]));
            
            // 创建测试用的分割结果
            const segmentationResults: SegmentationResult[] = [
                {
                    class_id: 1,
                    class_name: 'person',
                    confidence: 0.9,
                    bbox: { x1: 10, y1: 10, x2: 50, y2: 50, width: 40, height: 40 },
                    mask: { mask_data: [], area: 1600 }
                },
                {
                    class_id: 2,
                    class_name: 'bike', // 这个标签不存在于标签列表中
                    confidence: 0.7,
                    bbox: { x1: 110, y1: 110, x2: 150, y2: 150, width: 40, height: 40 },
                    mask: { mask_data: [], area: 1600 }
                }
            ];
            
            // 设置初始分割结果状态
            store.dispatch(updateSegmentationResults(segmentationResults));
            
            // 删除 'person' 标签
            LabelActions.removeLabelNames([testLabel1.id]);
            
            // 验证只有 'person' 对应的分割结果被删除，'bike' 保留
            const remainingResults = store.getState().ai.segmentationResults;
            expect(remainingResults).toHaveLength(1);
            expect(remainingResults[0].class_name).toBe('bike');
        });

        it('should remove matching results from every image cache', () => {
            const deletedLabel = LabelUtil.createLabelName('Person');
            const retainedLabel = LabelUtil.createLabelName('bike');
            store.dispatch(updateLabelNames([deletedLabel, retainedLabel]));

            const personResult: SegmentationResult = {
                class_id: 1,
                class_name: 'person',
                confidence: 0.9,
                bbox: { x1: 10, y1: 10, x2: 50, y2: 50, width: 40, height: 40 },
                mask: null
            };
            const bikeResult: SegmentationResult = {
                class_id: 2,
                class_name: 'bike',
                confidence: 0.8,
                bbox: { x1: 60, y1: 60, x2: 100, y2: 100, width: 40, height: 40 },
                mask: null
            };
            store.dispatch(updateSegmentationResults([personResult, bikeResult], 'image-1'));
            store.dispatch(updateSegmentationResults([personResult], 'image-2'));

            LabelActions.removeLabelNames([deletedLabel.id]);

            expect(store.getState().ai.imageSegmentationResults.get('image-1')).toEqual([bikeResult]);
            expect(store.getState().ai.imageSegmentationResults.get('image-2')).toEqual([]);
            expect(store.getState().ai.segmentationResults).toEqual([]);
        });
    });
});
