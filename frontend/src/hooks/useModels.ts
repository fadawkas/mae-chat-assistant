import { useEffect, useState } from 'react';
import { fetchModels, type ModelOption } from '../api/models';

export function useModels() {
  const [models, setModels] = useState<ModelOption[]>([]);
  useEffect(() => { fetchModels().then(setModels).catch(() => setModels([])); }, []);
  return models;
}
