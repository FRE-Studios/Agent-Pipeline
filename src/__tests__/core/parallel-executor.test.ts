// src/core/parallel-executor.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParallelExecutor, ParallelExecutionResult } from '../../core/parallel-executor.js';
import { StageExecutor } from '../../core/stage-executor.js';
import { AgentStageConfig, StageExecution, PipelineState } from '../../config/schema.js';
import { runningPipelineState, successfulStageExecution, failedStageExecution } from '../fixtures/pipeline-states.js';
import { parallelPipelineConfig, simplePipelineConfig } from '../fixtures/pipeline-configs.js';

describe('ParallelExecutor', () => {
  let mockStageExecutor: StageExecutor;
  let parallelExecutor: ParallelExecutor;
  let onStateChangeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create mock StageExecutor
    mockStageExecutor = {
      executeStage: vi.fn(),
    } as any;

    onStateChangeSpy = vi.fn();
    parallelExecutor = new ParallelExecutor(mockStageExecutor, onStateChangeSpy);
  });

  describe('executeParallelGroup', () => {
    describe('successful execution', () => {
      it('should execute multiple stages concurrently', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
          { name: 'stage2', agent: 'agent2.md' },
          { name: 'stage3', agent: 'agent3.md' },
        ];

        const execution1: StageExecution = { ...successfulStageExecution, stageName: 'stage1' };
        const execution2: StageExecution = { ...successfulStageExecution, stageName: 'stage2' };
        const execution3: StageExecution = { ...successfulStageExecution, stageName: 'stage3' };

        (mockStageExecutor.executeStage as any)
          .mockResolvedValueOnce(execution1)
          .mockResolvedValueOnce(execution2)
          .mockResolvedValueOnce(execution3);

        const result = await parallelExecutor.executeParallelGroup(
          stages,
          runningPipelineState
        );

        expect(mockStageExecutor.executeStage).toHaveBeenCalledTimes(3);
        expect(result.executions).toHaveLength(3);
        expect(result.executions[0].stageName).toBe('stage1');
        expect(result.executions[1].stageName).toBe('stage2');
        expect(result.executions[2].stageName).toBe('stage3');
      });

      it('should overlap execution windows when running in parallel', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'fast', agent: 'fast.md' },
          { name: 'slow', agent: 'slow.md' },
        ];

        const runningStages = new Set<string>();
        let observedOverlap = false;

        (mockStageExecutor.executeStage as any).mockImplementation(
          async (config: AgentStageConfig) => {
            runningStages.add(config.name);
            if (runningStages.size > 1) {
              observedOverlap = true;
            }
            await new Promise(resolve =>
              setTimeout(resolve, config.name === 'slow' ? 40 : 20)
            );
            runningStages.delete(config.name);
            return { ...successfulStageExecution, stageName: config.name };
          }
        );

        await parallelExecutor.executeParallelGroup(
          stages,
          runningPipelineState
        );

        expect(observedOverlap).toBe(true);
      });

      it('should set allSucceeded=true when all stages succeed', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
          { name: 'stage2', agent: 'agent2.md' },
        ];

        (mockStageExecutor.executeStage as any)
          .mockResolvedValue({ ...successfulStageExecution });

        const result = await parallelExecutor.executeParallelGroup(
          stages,
          runningPipelineState
        );

        expect(result.allSucceeded).toBe(true);
        expect(result.anyFailed).toBe(false);
      });

      it('should calculate duration correctly', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
        ];

        (mockStageExecutor.executeStage as any)
          .mockResolvedValue({ ...successfulStageExecution });

        const startTime = Date.now();
        const result = await parallelExecutor.executeParallelGroup(
          stages,
          runningPipelineState
        );
        const endTime = Date.now();

        expect(result.duration).toBeGreaterThanOrEqual(0);
        expect(result.duration).toBeLessThanOrEqual((endTime - startTime) / 1000 + 0.1);
      });

      it('should preserve execution order in results array', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage-a', agent: 'a.md' },
          { name: 'stage-b', agent: 'b.md' },
          { name: 'stage-c', agent: 'c.md' },
        ];

        (mockStageExecutor.executeStage as any)
          .mockImplementation((config: AgentStageConfig) =>
            Promise.resolve({ ...successfulStageExecution, stageName: config.name })
          );

        const result = await parallelExecutor.executeParallelGroup(
          stages,
          runningPipelineState
        );

        expect(result.executions.map(e => e.stageName)).toEqual(['stage-a', 'stage-b', 'stage-c']);
      });

      it('should handle single stage execution', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'solo', agent: 'solo.md' },
        ];

        (mockStageExecutor.executeStage as any)
          .mockResolvedValue({ ...successfulStageExecution, stageName: 'solo' });

        const result = await parallelExecutor.executeParallelGroup(
          stages,
          runningPipelineState
        );

        expect(result.executions).toHaveLength(1);
        expect(result.allSucceeded).toBe(true);
        expect(result.anyFailed).toBe(false);
      });

      it('should handle empty stages array', async () => {
        const result = await parallelExecutor.executeParallelGroup(
          [],
          runningPipelineState
        );

        expect(result.executions).toHaveLength(0);
        expect(result.allSucceeded).toBe(true);
        expect(result.anyFailed).toBe(false);
        expect(result.duration).toBeGreaterThanOrEqual(0);
      });
    });

    describe('error handling and mixed results', () => {
      it('should set anyFailed=true when some stages fail', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
          { name: 'stage2', agent: 'agent2.md' },
        ];

        (mockStageExecutor.executeStage as any)
          .mockResolvedValueOnce({ ...successfulStageExecution })
          .mockResolvedValueOnce({ ...failedStageExecution });

        const result = await parallelExecutor.executeParallelGroup(
          stages,
          runningPipelineState
        );

        expect(result.allSucceeded).toBe(false);
        expect(result.anyFailed).toBe(true);
      });

      it('should set both flags correctly when all stages fail', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
          { name: 'stage2', agent: 'agent2.md' },
        ];

        (mockStageExecutor.executeStage as any)
          .mockResolvedValue({ ...failedStageExecution });

        const result = await parallelExecutor.executeParallelGroup(
          stages,
          runningPipelineState
        );

        expect(result.allSucceeded).toBe(false);
        expect(result.anyFailed).toBe(true);
      });

      it('should handle rejected promises using Promise.allSettled', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
          { name: 'stage2', agent: 'agent2.md' },
        ];

        const error = new Error('Stage execution failed');
        (error as any).stack = 'Error stack trace';

        (mockStageExecutor.executeStage as any)
          .mockResolvedValueOnce({ ...successfulStageExecution })
          .mockRejectedValueOnce(error);

        const result = await parallelExecutor.executeParallelGroup(
          stages,
          runningPipelineState
        );

        expect(result.executions).toHaveLength(2);
        expect(result.executions[0].status).toBe('success');
        expect(result.executions[1].status).toBe('failed');
        expect(result.anyFailed).toBe(true);
      });

      it('should convert rejected promises to failed StageExecution objects', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'failing-stage', agent: 'failing.md' },
        ];

        const error = new Error('Execution error');
        (error as any).stack = 'Error: Execution error\n  at ...';

        (mockStageExecutor.executeStage as any).mockRejectedValue(error);

        const result = await parallelExecutor.executeParallelGroup(
          stages,
          runningPipelineState
        );

        const failedExecution = result.executions[0];
        expect(failedExecution.status).toBe('failed');
        expect(failedExecution.stageName).toBe('failing-stage');
        expect(failedExecution.error?.message).toBe('Execution error');
        expect(failedExecution.error?.stack).toBe('Error: Execution error\n  at ...');
        expect(failedExecution.error?.agentPath).toBe('failing.md');
        expect(failedExecution.error?.timestamp).toBeDefined();
      });

      it('should handle unknown error reasons', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
        ];

        (mockStageExecutor.executeStage as any).mockRejectedValue('string error');

        const result = await parallelExecutor.executeParallelGroup(
          stages,
          runningPipelineState
        );

        expect(result.executions[0].error?.message).toBe('string error');
      });

      it('should handle errors without stack traces', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
        ];

        const errorWithoutStack = new Error('No stack');
        delete (errorWithoutStack as any).stack;

        (mockStageExecutor.executeStage as any).mockRejectedValue(errorWithoutStack);

        const result = await parallelExecutor.executeParallelGroup(
          stages,
          runningPipelineState
        );

        expect(result.executions[0].error?.message).toBe('No stack');
        expect(result.executions[0].error?.stack).toBeUndefined();
      });

      it('should complete all stages even when some fail', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
          { name: 'stage2', agent: 'agent2.md' },
          { name: 'stage3', agent: 'agent3.md' },
        ];

        (mockStageExecutor.executeStage as any)
          .mockRejectedValueOnce(new Error('Failed 1'))
          .mockResolvedValueOnce({ ...successfulStageExecution, stageName: 'stage2' })
          .mockRejectedValueOnce(new Error('Failed 3'));

        const result = await parallelExecutor.executeParallelGroup(
          stages,
          runningPipelineState
        );

        expect(result.executions).toHaveLength(3);
        expect(result.executions[0].status).toBe('failed');
        expect(result.executions[1].status).toBe('success');
        expect(result.executions[2].status).toBe('failed');
      });
    });

    describe('output callbacks', () => {
      it('should call onOutputUpdate with correct stageName', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'test-stage', agent: 'test.md' },
        ];

        const outputCallback = vi.fn();

        // Mock executeStage to call the output callback
        (mockStageExecutor.executeStage as any).mockImplementation(
          async (config: AgentStageConfig, state: PipelineState, callback?: Function) => {
            if (callback) {
              callback('Stage output line 1');
              callback('Stage output line 2');
            }
            return { ...successfulStageExecution, stageName: config.name };
          }
        );

        await parallelExecutor.executeParallelGroup(
          stages,
          runningPipelineState,
          outputCallback
        );

        expect(outputCallback).toHaveBeenCalledWith('test-stage', 'Stage output line 1');
        expect(outputCallback).toHaveBeenCalledWith('test-stage', 'Stage output line 2');
      });

      it('should call separate callbacks for different stages', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage-a', agent: 'a.md' },
          { name: 'stage-b', agent: 'b.md' },
        ];

        const outputCallback = vi.fn();

        (mockStageExecutor.executeStage as any).mockImplementation(
          async (config: AgentStageConfig, state: PipelineState, callback?: Function) => {
            if (callback) {
              callback(`Output from ${config.name}`);
            }
            return { ...successfulStageExecution, stageName: config.name };
          }
        );

        await parallelExecutor.executeParallelGroup(
          stages,
          runningPipelineState,
          outputCallback
        );

        expect(outputCallback).toHaveBeenCalledWith('stage-a', 'Output from stage-a');
        expect(outputCallback).toHaveBeenCalledWith('stage-b', 'Output from stage-b');
      });

      it('should work without output callback', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
        ];

        (mockStageExecutor.executeStage as any)
          .mockResolvedValue({ ...successfulStageExecution });

        const result = await parallelExecutor.executeParallelGroup(
          stages,
          runningPipelineState
        );

        expect(result.allSucceeded).toBe(true);
      });

      it('should pass undefined callback when not provided', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
        ];

        (mockStageExecutor.executeStage as any)
          .mockResolvedValue({ ...successfulStageExecution });

        await parallelExecutor.executeParallelGroup(
          stages,
          runningPipelineState
        );

        const calls = (mockStageExecutor.executeStage as any).mock.calls;
        expect(calls[0][2]).toBeUndefined();
      });
    });

    describe('edge cases', () => {
      it('should handle stages with different execution times', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'fast', agent: 'fast.md' },
          { name: 'slow', agent: 'slow.md' },
        ];

        (mockStageExecutor.executeStage as any)
          .mockImplementation((config: AgentStageConfig) => {
            const delay = config.name === 'slow' ? 100 : 10;
            return new Promise(resolve => setTimeout(() => {
              resolve({ ...successfulStageExecution, stageName: config.name });
            }, delay));
          });

        const result = await parallelExecutor.executeParallelGroup(
          stages,
          runningPipelineState
        );

        expect(result.executions).toHaveLength(2);
        expect(result.duration).toBeGreaterThanOrEqual(0.09); // At least 90ms (allowing for timer precision)
      });

      it('should pass pipelineState to each stage executor', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
          { name: 'stage2', agent: 'agent2.md' },
        ];

        (mockStageExecutor.executeStage as any)
          .mockResolvedValue({ ...successfulStageExecution });

        await parallelExecutor.executeParallelGroup(
          stages,
          runningPipelineState
        );

        const calls = (mockStageExecutor.executeStage as any).mock.calls;
        expect(calls[0][1]).toBe(runningPipelineState);
        expect(calls[1][1]).toBe(runningPipelineState);
      });

      it('should pass stage config to executor', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'custom-stage', agent: 'custom.md', timeout: 300 },
        ];

        (mockStageExecutor.executeStage as any)
          .mockResolvedValue({ ...successfulStageExecution });

        await parallelExecutor.executeParallelGroup(
          stages,
          runningPipelineState
        );

        const calls = (mockStageExecutor.executeStage as any).mock.calls;
        expect(calls[0][0]).toEqual(stages[0]);
      });

      it('should notify onStateChange when adding running stages and after each completes', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'alpha', agent: 'alpha.md' },
          { name: 'beta', agent: 'beta.md' },
        ];

        (mockStageExecutor.executeStage as any)
          .mockResolvedValue({ ...successfulStageExecution });

        await parallelExecutor.executeParallelGroup(
          stages,
          runningPipelineState
        );

        // Called: 1x for adding all running stages + 2x for each stage completing
        expect(onStateChangeSpy).toHaveBeenCalledTimes(3);
        for (const call of onStateChangeSpy.mock.calls) {
          expect(call[0]).toBe(runningPipelineState);
        }
      });
    });
  });

  describe('executeSequentialGroup', () => {
    describe('sequential execution flow', () => {
      it('should execute stages one at a time in order', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
          { name: 'stage2', agent: 'agent2.md' },
          { name: 'stage3', agent: 'agent3.md' },
        ];

        const executionOrder: string[] = [];

        (mockStageExecutor.executeStage as any).mockImplementation(
          async (config: AgentStageConfig) => {
            executionOrder.push(config.name);
            return { ...successfulStageExecution, stageName: config.name };
          }
        );

        await parallelExecutor.executeSequentialGroup(
          stages,
          runningPipelineState
        );

        expect(executionOrder).toEqual(['stage1', 'stage2', 'stage3']);
      });

      it('should wait for each stage to complete before starting next', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
          { name: 'stage2', agent: 'agent2.md' },
        ];

        let stage1Completed = false;

        (mockStageExecutor.executeStage as any).mockImplementation(
          async (config: AgentStageConfig) => {
            if (config.name === 'stage1') {
              await new Promise(resolve => setTimeout(resolve, 50));
              stage1Completed = true;
              return { ...successfulStageExecution, stageName: 'stage1' };
            } else {
              expect(stage1Completed).toBe(true);
              return { ...successfulStageExecution, stageName: 'stage2' };
            }
          }
        );

        await parallelExecutor.executeSequentialGroup(
          stages,
          runningPipelineState
        );
      });

      it('should set allSucceeded=true when all stages succeed', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
          { name: 'stage2', agent: 'agent2.md' },
        ];

        (mockStageExecutor.executeStage as any)
          .mockResolvedValue({ ...successfulStageExecution });

        const result = await parallelExecutor.executeSequentialGroup(
          stages,
          runningPipelineState
        );

        expect(result.allSucceeded).toBe(true);
        expect(result.anyFailed).toBe(false);
      });

      it('should calculate duration as sum of sequential executions', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
          { name: 'stage2', agent: 'agent2.md' },
        ];

        (mockStageExecutor.executeStage as any).mockImplementation(
          async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            return { ...successfulStageExecution };
          }
        );

        const result = await parallelExecutor.executeSequentialGroup(
          stages,
          runningPipelineState
        );

        // Should be at least 100ms (2 stages × 50ms each)
        expect(result.duration).toBeGreaterThanOrEqual(0.1);
      });

      it('should return executions in order', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'alpha', agent: 'alpha.md' },
          { name: 'beta', agent: 'beta.md' },
          { name: 'gamma', agent: 'gamma.md' },
        ];

        (mockStageExecutor.executeStage as any).mockImplementation(
          async (config: AgentStageConfig) =>
            ({ ...successfulStageExecution, stageName: config.name })
        );

        const result = await parallelExecutor.executeSequentialGroup(
          stages,
          runningPipelineState
        );

        expect(result.executions.map(e => e.stageName)).toEqual(['alpha', 'beta', 'gamma']);
      });
    });

    describe('state management', () => {
      it('should add stages to pipelineState as running then update when complete', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
          { name: 'stage2', agent: 'agent2.md' },
        ];

        const state = { ...runningPipelineState, stages: [] as any[] };
        const execution1 = { ...successfulStageExecution, stageName: 'stage1' };
        const execution2 = { ...successfulStageExecution, stageName: 'stage2' };

        (mockStageExecutor.executeStage as any)
          .mockResolvedValueOnce(execution1)
          .mockResolvedValueOnce(execution2);

        const result = await parallelExecutor.executeSequentialGroup(stages, state);

        expect(result.executions).toEqual([execution1, execution2]);
        // Now stages ARE added to state (as running, then updated)
        expect(state.stages).toHaveLength(2);
        expect(state.stages[0]).toEqual(execution1);
        expect(state.stages[1]).toEqual(execution2);
      });

      it('should call onStateChange for each running stage and completion', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
          { name: 'stage2', agent: 'agent2.md' },
        ];

        const state = { ...runningPipelineState, stages: [] as any[] };

        (mockStageExecutor.executeStage as any)
          .mockResolvedValue({ ...successfulStageExecution });

        await parallelExecutor.executeSequentialGroup(stages, state);

        // Called: 2x for adding running (once per stage) + 2x for completion
        expect(onStateChangeSpy).toHaveBeenCalledTimes(4);
        for (const call of onStateChangeSpy.mock.calls) {
          expect(call[0]).toBe(state);
        }
      });

      it('should work without onStateChange callback', async () => {
        const executorWithoutCallback = new ParallelExecutor(mockStageExecutor);
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
        ];

        (mockStageExecutor.executeStage as any)
          .mockResolvedValue({ ...successfulStageExecution });

        const result = await executorWithoutCallback.executeSequentialGroup(
          stages,
          runningPipelineState
        );

        expect(result.allSucceeded).toBe(true);
      });
    });

    describe('failure scenarios', () => {
      it('should set anyFailed=true when a stage fails', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
          { name: 'stage2', agent: 'agent2.md' },
        ];

        (mockStageExecutor.executeStage as any)
          .mockResolvedValueOnce({ ...successfulStageExecution })
          .mockResolvedValueOnce({ ...failedStageExecution });

        const result = await parallelExecutor.executeSequentialGroup(
          stages,
          runningPipelineState
        );

        expect(result.anyFailed).toBe(true);
        expect(result.allSucceeded).toBe(false);
      });

      it('should continue executing subsequent stages after failure', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
          { name: 'stage2', agent: 'agent2.md' },
          { name: 'stage3', agent: 'agent3.md' },
        ];

        (mockStageExecutor.executeStage as any)
          .mockResolvedValueOnce({ ...successfulStageExecution })
          .mockResolvedValueOnce({ ...failedStageExecution })
          .mockResolvedValueOnce({ ...successfulStageExecution });

        const result = await parallelExecutor.executeSequentialGroup(
          stages,
          runningPipelineState
        );

        expect(result.executions).toHaveLength(3);
        expect(mockStageExecutor.executeStage).toHaveBeenCalledTimes(3);
      });

      it('should include failed execution in results', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'failing', agent: 'fail.md' },
        ];

        const failedExec = { ...failedStageExecution, stageName: 'failing' };
        (mockStageExecutor.executeStage as any).mockResolvedValue(failedExec);

        const result = await parallelExecutor.executeSequentialGroup(
          stages,
          runningPipelineState
        );

        expect(result.executions[0]).toEqual(failedExec);
      });

      it('should convert rejected stages into failed executions and continue', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'unstable', agent: 'unstable.md' },
          { name: 'recovery', agent: 'recovery.md' },
        ];

        const rejectedError = new Error('boom');
        (mockStageExecutor.executeStage as any)
          .mockRejectedValueOnce(rejectedError)
          .mockResolvedValueOnce({ ...successfulStageExecution, stageName: 'recovery' });

        const result = await parallelExecutor.executeSequentialGroup(
          stages,
          runningPipelineState
        );

        expect(result.executions).toHaveLength(2);
        expect(result.executions[0].status).toBe('failed');
        expect(result.executions[0].stageName).toBe('unstable');
        expect(result.executions[0].error?.message).toBe('boom');
        expect(result.executions[0].error?.agentPath).toBe('unstable.md');
        expect(result.executions[1].stageName).toBe('recovery');
      });
    });

    describe('output callbacks', () => {
      it('should call onOutputUpdate for each stage', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage-a', agent: 'a.md' },
          { name: 'stage-b', agent: 'b.md' },
        ];

        const outputCallback = vi.fn();

        (mockStageExecutor.executeStage as any).mockImplementation(
          async (config: AgentStageConfig, state: PipelineState, callback?: Function) => {
            if (callback) {
              callback(`Output from ${config.name}`);
            }
            return { ...successfulStageExecution, stageName: config.name };
          }
        );

        await parallelExecutor.executeSequentialGroup(
          stages,
          runningPipelineState,
          outputCallback
        );

        expect(outputCallback).toHaveBeenCalledWith('stage-a', 'Output from stage-a');
        expect(outputCallback).toHaveBeenCalledWith('stage-b', 'Output from stage-b');
      });

      it('should work without output callback', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
        ];

        (mockStageExecutor.executeStage as any)
          .mockResolvedValue({ ...successfulStageExecution });

        const result = await parallelExecutor.executeSequentialGroup(
          stages,
          runningPipelineState
        );

        expect(result.allSucceeded).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should handle empty stages array', async () => {
        const result = await parallelExecutor.executeSequentialGroup(
          [],
          runningPipelineState
        );

        expect(result.executions).toHaveLength(0);
        expect(result.allSucceeded).toBe(true);
        expect(result.anyFailed).toBe(false);
        expect(result.duration).toBeGreaterThanOrEqual(0);
      });

      it('should handle single stage', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'solo', agent: 'solo.md' },
        ];

        (mockStageExecutor.executeStage as any)
          .mockResolvedValue({ ...successfulStageExecution });

        const result = await parallelExecutor.executeSequentialGroup(
          stages,
          runningPipelineState
        );

        expect(result.executions).toHaveLength(1);
        expect(result.allSucceeded).toBe(true);
      });

      it('should add executed stage to pipeline state stages array', async () => {
        const stages: AgentStageConfig[] = [
          { name: 'stage1', agent: 'agent1.md' },
        ];

        const originalState = { ...runningPipelineState };
        const originalStagesLength = originalState.stages.length;

        (mockStageExecutor.executeStage as any)
          .mockResolvedValue({ ...successfulStageExecution });

        await parallelExecutor.executeSequentialGroup(stages, originalState);

        // Now stages ARE added to state for real-time UI updates
        expect(originalState.stages.length).toBe(originalStagesLength + 1);
      });
    });
  });

  describe('aggregateResults', () => {
    it('should format results when all stages succeed', () => {
      const result: ParallelExecutionResult = {
        executions: [
          { ...successfulStageExecution, stageName: 'stage1' },
          { ...successfulStageExecution, stageName: 'stage2' },
          { ...successfulStageExecution, stageName: 'stage3' },
        ],
        allSucceeded: true,
        anyFailed: false,
        duration: 5.234,
      };

      const summary = parallelExecutor.aggregateResults(result);

      expect(summary).toBe('Completed 3 stages in 5.2s (3 succeeded, 0 failed)');
    });

    it('should format results when all stages fail', () => {
      const result: ParallelExecutionResult = {
        executions: [
          { ...failedStageExecution, stageName: 'stage1' },
          { ...failedStageExecution, stageName: 'stage2' },
        ],
        allSucceeded: false,
        anyFailed: true,
        duration: 3.789,
      };

      const summary = parallelExecutor.aggregateResults(result);

      expect(summary).toBe('Completed 2 stages in 3.8s (0 succeeded, 2 failed)');
    });

    it('should format results with mixed success and failure', () => {
      const result: ParallelExecutionResult = {
        executions: [
          { ...successfulStageExecution, stageName: 'stage1' },
          { ...failedStageExecution, stageName: 'stage2' },
          { ...successfulStageExecution, stageName: 'stage3' },
        ],
        allSucceeded: false,
        anyFailed: true,
        duration: 10.567,
      };

      const summary = parallelExecutor.aggregateResults(result);

      expect(summary).toBe('Completed 3 stages in 10.6s (2 succeeded, 1 failed)');
    });

    it('should round duration to 1 decimal place', () => {
      const result: ParallelExecutionResult = {
        executions: [{ ...successfulStageExecution }],
        allSucceeded: true,
        anyFailed: false,
        duration: 1.9999,
      };

      const summary = parallelExecutor.aggregateResults(result);

      expect(summary).toContain('2.0s');
    });

    it('should handle very short durations', () => {
      const result: ParallelExecutionResult = {
        executions: [{ ...successfulStageExecution }],
        allSucceeded: true,
        anyFailed: false,
        duration: 0.045,
      };

      const summary = parallelExecutor.aggregateResults(result);

      expect(summary).toContain('0.0s');
    });

    it('should handle long durations', () => {
      const result: ParallelExecutionResult = {
        executions: [{ ...successfulStageExecution }],
        allSucceeded: true,
        anyFailed: false,
        duration: 123.456,
      };

      const summary = parallelExecutor.aggregateResults(result);

      expect(summary).toContain('123.5s');
    });

    it('should handle zero stages', () => {
      const result: ParallelExecutionResult = {
        executions: [],
        allSucceeded: true,
        anyFailed: false,
        duration: 0,
      };

      const summary = parallelExecutor.aggregateResults(result);

      expect(summary).toBe('Completed 0 stages in 0.0s (0 succeeded, 0 failed)');
    });

    it('should handle single stage success', () => {
      const result: ParallelExecutionResult = {
        executions: [{ ...successfulStageExecution }],
        allSucceeded: true,
        anyFailed: false,
        duration: 1.5,
      };

      const summary = parallelExecutor.aggregateResults(result);

      expect(summary).toBe('Completed 1 stages in 1.5s (1 succeeded, 0 failed)');
    });

    it('should handle single stage failure', () => {
      const result: ParallelExecutionResult = {
        executions: [{ ...failedStageExecution }],
        allSucceeded: false,
        anyFailed: true,
        duration: 2.3,
      };

      const summary = parallelExecutor.aggregateResults(result);

      expect(summary).toBe('Completed 1 stages in 2.3s (0 succeeded, 1 failed)');
    });
  });

  describe('constructor and integration', () => {
    it('should accept stageExecutor and onStateChange callback', () => {
      const executor = new ParallelExecutor(mockStageExecutor, onStateChangeSpy);
      expect(executor).toBeInstanceOf(ParallelExecutor);
    });

    it('should accept stageExecutor without callback', () => {
      const executor = new ParallelExecutor(mockStageExecutor);
      expect(executor).toBeInstanceOf(ParallelExecutor);
    });

    it('should pass correct parameters to StageExecutor.executeStage', async () => {
      const stages: AgentStageConfig[] = [
        { name: 'test', agent: 'test.md', timeout: 300 },
      ];

      const outputCallback = vi.fn();

      (mockStageExecutor.executeStage as any)
        .mockResolvedValue({ ...successfulStageExecution });

      await parallelExecutor.executeParallelGroup(
        stages,
        runningPipelineState,
        outputCallback
      );

      expect(mockStageExecutor.executeStage).toHaveBeenCalledWith(
        stages[0],
        runningPipelineState,
        expect.any(Function)
      );
    });

    it('should work with real pipeline config fixtures', async () => {
      const stages = simplePipelineConfig.agents;

      (mockStageExecutor.executeStage as any).mockImplementation(
        async (config: AgentStageConfig) => ({
          ...successfulStageExecution,
          stageName: config.name,
        })
      );

      const result = await parallelExecutor.executeParallelGroup(
        stages,
        runningPipelineState
      );

      expect(result.executions).toHaveLength(stages.length);
      expect(result.allSucceeded).toBe(true);
    });
  });
});
