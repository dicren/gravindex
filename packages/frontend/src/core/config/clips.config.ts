import { AddTagUseCase } from '#/application/clips/add-tag.use-case';
import { CreateClipUseCase } from '#/application/clips/create-clip.use-case';
import { GetClipUseCase } from '#/application/clips/get-clip.use-case';
import { ListClipsUseCase } from '#/application/clips/list-clips.use-case';
import { ListRelatedClipsUseCase } from '#/application/clips/list-related-clips.use-case';
import { RegisterPlayUseCase } from '#/application/clips/register-play.use-case';
import { VoteClipUseCase } from '#/application/clips/vote-clip.use-case';
import { ClipHttpRepository } from '#/infrastructure/clips/clip-http.repository';
import { voterTokenProvider } from './identity.config';

/**
 * Composition root for the clips feature: one repository instance, shared by
 * every use case built on it. Same shape as `tags.config.ts` — plain
 * module-level singletons, no container.
 *
 * ⚠️ This is where anonymous identity is wired in, and the only place clips
 * and identity meet: the repository takes the provider, so no use case, view
 * or store ever handles a token (see `domain/identity/voter-token.provider.ts`).
 */
const clipRepository = new ClipHttpRepository(voterTokenProvider);

export const listClipsUseCase = new ListClipsUseCase(clipRepository);
export const getClipUseCase = new GetClipUseCase(clipRepository);
export const listRelatedClipsUseCase = new ListRelatedClipsUseCase(clipRepository);
export const createClipUseCase = new CreateClipUseCase(clipRepository);
export const registerPlayUseCase = new RegisterPlayUseCase(clipRepository);
export const voteClipUseCase = new VoteClipUseCase(clipRepository);
export const addTagUseCase = new AddTagUseCase(clipRepository);
