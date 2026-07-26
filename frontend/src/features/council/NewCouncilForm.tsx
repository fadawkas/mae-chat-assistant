import { useEffect, useMemo, useState } from 'react';
import type { CouncilConfigCreate, CouncilConfigDetail, CouncilConfigMemberIn } from '../../types';
import { CouncilGraph, type MemberNodeStatus } from './CouncilGraph';
import { MemberCard } from './MemberCard';
import { ModelPicker } from '../../components/common/ModelPicker';

export interface NewCouncilFormProps {
  onSave: (data: CouncilConfigCreate) => Promise<void>;
  onCancel: () => void;
  initial?: CouncilConfigDetail;
}

export function NewCouncilForm({ onSave, onCancel, initial }: NewCouncilFormProps) {
  const isEditing = !!initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [judgeModel, setJudgeModel] = useState(initial?.judge_model ?? '');
  const [members, setMembers] = useState<CouncilConfigMemberIn[]>(
    initial && initial.members.length > 0
      ? initial.members.map(m => ({ model: m.model, system_prompt: m.system_prompt }))
      : [{ model: '', system_prompt: null }],
  );
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  // Validation
  const nameError = touched && !name.trim() ? 'Council needs a name.' : null;
  const judgeError = touched && !judgeModel.trim() ? 'Select a judge model.' : null;
  const validMembers = members.filter(m => m.model.trim().length > 0);
  const membersError = touched && validMembers.length === 0 ? 'Add at least one member.' : null;
  const hasJudgeMemberDup = useMemo(
    () => judgeModel.trim().length > 0 && members.some(m => m.model.trim() === judgeModel.trim()),
    [judgeModel, members],
  );

  const canSave = name.trim().length > 0 && judgeModel.trim().length > 0 && validMembers.length > 0 && !saving;

  const handleSave = async () => {
    setTouched(true);
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || null,
        judge_model: judgeModel.trim() || null,
        members: members.map(m => ({
          model: m.model.trim(),
          system_prompt: m.system_prompt?.trim() || null,
        })),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleMemberChange = (index: number, data: CouncilConfigMemberIn) => {
    setTouched(true);
    setMembers(prev => {
      const copy = [...prev];
      copy[index] = data;
      return copy;
    });
  };

  const handleMemberRemove = (index: number) => {
    setTouched(true);
    setMembers(prev => prev.filter((_, i) => i !== index));
  };

  const addMember = () => {
    setMembers(prev => [...prev, { model: '', system_prompt: null }]);
  };

  // Live preview data for CouncilGraph
  const previewMembers = useMemo(
    () =>
      members.map((m, i) => ({
        id: `member-${i}`,
        model: m.model.trim() || `Member ${i + 1}`,
        status: 'pending' as MemberNodeStatus,
        systemPrompt: m.system_prompt || undefined,
      })),
    [members],
  );
  const previewJudgeModel = judgeModel.trim() || 'Judge';

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      {/* Dimmed backdrop */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Modal */}
      <div
        className="relative z-10 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto flex flex-col gap-5 p-6 rounded-[14px] border border-mae-border"
        style={{
          background: 'rgba(22, 22, 22, 0.85)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
        }}
      >
        {/* Title */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mae-muted">
            {isEditing ? 'Edit Council' : 'New Council'}
          </span>
        </div>

        {/* Name */}
        <div className="flex flex-col gap-1">
          <input
            value={name}
            onChange={e => { setTouched(true); setName(e.target.value); }}
            placeholder="Council name"
            className="w-full px-3 py-2 rounded-[8px] bg-mae-bg text-mae-text text-sm border border-mae-border placeholder:text-mae-muted/50 focus-visible:outline-2 focus-visible:outline-mae-accent focus-visible:outline-offset-2"
          />
          {nameError && (
            <span className="text-[11px] text-mae-error/80">{nameError}</span>
          )}
        </div>

        {/* Description */}
        <input
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="w-full px-3 py-2 rounded-[8px] bg-mae-bg text-mae-text text-sm border border-mae-border placeholder:text-mae-muted/50 focus-visible:outline-2 focus-visible:outline-mae-accent focus-visible:outline-offset-2"
        />

        {/* Judge model section */}
        <div className="flex flex-col gap-2 p-4 rounded-[10px] bg-mae-bubble-assistant border border-mae-border">
          <div className="flex items-center gap-2">
            <svg
              className="w-3.5 h-3.5 text-mae-muted shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mae-muted">
              Judge Model
            </span>
          </div>
          <ModelPicker value={judgeModel} onChange={value => { setTouched(true); setJudgeModel(value); }} placeholder="Select judge model" />
          {judgeError && (
            <span className="text-[11px] text-mae-error/80">{judgeError}</span>
          )}
          {hasJudgeMemberDup && !judgeError && (
            <span className="text-[11px] text-yellow-500">
              Judge and a member are using the same model.
            </span>
          )}
        </div>

        {/* Live preview graph */}
        {judgeModel.trim() || members.some(m => m.model.trim()) ? (
          <div className="flex justify-center py-2">
            <CouncilGraph
              members={previewMembers}
              judgeModel={previewJudgeModel}
              judgeStatus="idle"
              idle
            />
          </div>
        ) : null}

        {/* Members section */}
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mae-muted">
            Members
          </span>
          <div className="flex flex-col gap-3 mt-1">
            {members.map((m, i) => (
              <MemberCard
                key={i}
                member={m}
                index={i}
                onChange={handleMemberChange}
                onRemove={handleMemberRemove}
                canRemove={members.length > 1}
              />
            ))}
          </div>
          {membersError && (
            <span className="text-[11px] text-mae-error/80 mt-1">{membersError}</span>
          )}
          <button
            onClick={addMember}
            className="self-start mt-2 px-3 py-1.5 rounded-[8px] text-xs text-mae-muted bg-transparent border border-mae-border cursor-pointer hover:border-mae-accent hover:text-mae-accent transition-colors"
          >
            + Add member
          </button>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-2 border-t border-mae-border">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-[10px] text-sm text-mae-muted bg-transparent border border-mae-border cursor-pointer hover:text-mae-text hover:border-mae-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="px-4 py-2 rounded-[10px] text-sm text-mae-accent-on bg-mae-accent cursor-pointer hover:opacity-90 disabled:opacity-35 disabled:cursor-not-allowed border-none font-medium"
          >
            {saving ? 'Saving…' : isEditing ? 'Update Council' : 'Save Council'}
          </button>
        </div>
      </div>
    </div>
  );
}
