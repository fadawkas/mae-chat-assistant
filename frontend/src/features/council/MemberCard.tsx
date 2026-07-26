import type { CouncilConfigMemberIn } from '../../types';
import { ModelPicker } from '../../components/common/ModelPicker';

export interface MemberCardProps {
  member: CouncilConfigMemberIn;
  index: number;
  onChange: (index: number, data: CouncilConfigMemberIn) => void;
  onRemove: (index: number) => void;
  canRemove: boolean;
}

export function MemberCard({ member, index, onChange, onRemove, canRemove }: MemberCardProps) {
  return (
    <div className="flex flex-col gap-3 p-4 rounded-[10px] bg-mae-bubble-assistant border border-mae-border">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mae-muted shrink-0">
          Member {index + 1}
        </span>
        {canRemove && (
          <button
            onClick={() => onRemove(index)}
            className="flex items-center justify-center w-5 h-5 rounded text-mae-muted hover:text-mae-text cursor-pointer bg-transparent border-none text-sm leading-none"
            aria-label={`Remove member ${index + 1}`}
          >
            ×
          </button>
        )}
      </div>

      <ModelPicker value={member.model} onChange={value => onChange(index, { ...member, model: value })} placeholder="Select member model" />

      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-mae-muted tracking-wide">
          System prompt for this member (optional)
        </span>
        <input
          value={member.system_prompt ?? ''}
          onChange={e => onChange(index, { ...member, system_prompt: e.target.value || null })}
          placeholder="System prompt (optional)"
          className="w-full px-3 py-2 rounded-[8px] bg-mae-bg text-mae-text text-sm border border-mae-border placeholder:text-mae-muted/50 focus-visible:outline-2 focus-visible:outline-mae-accent focus-visible:outline-offset-2"
        />
      </div>
    </div>
  );
}
