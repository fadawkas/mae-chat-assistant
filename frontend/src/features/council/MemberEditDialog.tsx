import { useEffect, useState } from 'react';
import type { CouncilConfigMemberOut } from '../../types';
import { ModelPicker } from '../../components/common/ModelPicker';

export interface MemberEditDialogProps {
  member: CouncilConfigMemberOut;
  onSave: (memberId: string, model: string, systemPrompt: string | null) => void;
  onClose: () => void;
}

export function MemberEditDialog({ member, onSave, onClose }: MemberEditDialogProps) {
  const [model, setModel] = useState(member.model);
  const [systemPrompt, setSystemPrompt] = useState(member.system_prompt ?? '');

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSave = () => {
    if (!model.trim()) return;
    onSave(member.id, model.trim(), systemPrompt.trim() || null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative z-10 w-full max-w-md mx-4 flex flex-col gap-5 p-6 rounded-[14px] border border-mae-border"
        style={{
          background: 'rgba(22, 22, 22, 0.85)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
        }}
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mae-muted">
          Edit Member
        </span>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mae-muted">
            Model
          </label>
          <ModelPicker value={model} onChange={setModel} placeholder="Select member model" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mae-muted">
            System Prompt
          </label>
          <textarea
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            placeholder="Optional system prompt for this member…"
            rows={5}
            className="w-full resize-none px-3 py-2 rounded-[8px] bg-mae-bg text-mae-text text-sm border border-mae-border placeholder:text-mae-muted/50 focus-visible:outline-2 focus-visible:outline-mae-accent focus-visible:outline-offset-2"
          />
        </div>

        <div className="flex gap-2 justify-end pt-2 border-t border-mae-border">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-[10px] text-sm text-mae-muted bg-transparent border border-mae-border cursor-pointer hover:text-mae-text hover:border-mae-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!model.trim()}
            className="px-4 py-2 rounded-[10px] text-sm text-mae-accent-on bg-mae-accent cursor-pointer hover:opacity-90 disabled:opacity-35 disabled:cursor-not-allowed border-none font-medium"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
