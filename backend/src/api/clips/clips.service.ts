import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Episode } from '../../database/entities/Episode';
import { Clip } from '../../database/entities/Clip';
import { Brackets, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Tag } from '../../database/entities/Tag';
import { Vote } from '../../database/entities/Vote';
import { CreateClipDTO } from './DTO/request/CreateClipDTO';
import { Playback } from '../../database/entities/Playback';
import { QueryOptionsDTO } from './DTO/request/QueryOptionsDTO';

@Injectable()
export class ClipsService {
  constructor(
    @InjectRepository(Clip)
    private readonly clipRepository: Repository<Clip>,
    @InjectRepository(Episode)
    private readonly episodeRepository: Repository<Episode>,
    @InjectRepository(Tag)
    private readonly tagRepository: Repository<Tag>,
    @InjectRepository(Vote)
    private readonly voteRepository: Repository<Vote>,
    @InjectRepository(Playback)
    private readonly playbackRepository: Repository<Playback>,
  ) {}

  async getClips(query: QueryOptionsDTO) {
    // Primero obtengo los id de la búsqueda y luego hago la búsqueda completa
    // ya que typeorm aún no me deja hacerlo de una.
    const sql = this.clipRepository.createQueryBuilder('clip').leftJoin(
      `(SELECT clip.id as id,
        ABS(SUM(CASE WHEN vote.value < 0 THEN vote.value ELSE 0 END)) as down,
        SUM(CASE WHEN vote.value > 0 THEN vote.value ELSE 0 END) as up,
        IFNULL(SUM(vote.value),0) as points
        FROM clip
        LEFT JOIN vote ON vote.clip = clip.id
        GROUP BY clip.id)`,
      'values',
      'values.id = clip.id',
    );

    sql.leftJoin('Tag', 'tag', 'tag.clipid = clip.id');

    if (query.order === 'episode.date' || query.search) {
      sql.innerJoin('episode', 'episode', 'episode.id = clip.episode');
    }
    sql.where('1');

    // Debería encontrar una manera más digna de hacer esto.
    if (query.tags && query.tags.length > 0) {
      sql.having('1');
      for (let i = 0; i < query.tags.length; i++) {
        sql.andHaving(
          'CONCAT("||",GROUP_CONCAT(`tag`.`tag` SEPARATOR "||"),"||") like :ht' +
            i,
          {
            ['ht' + i]: '%||' + query.tags[i] + '||%',
          },
        );
      }
    }

    // Tipos de ordenamiento, búsqueda y demás.
    sql.addOrderBy(query.order || 'values.points', 'DESC');

    if (query.search) {
      sql.setParameter('search', '%' + query.search + '%');
      sql.andWhere(
        new Brackets((qb) => {
          qb.where(
            'CONVERT(clip.title USING utf8) LIKE _utf8 :search COLLATE utf8_general_ci',
          )
            .orWhere(
              'CONVERT(episode.title USING utf8) LIKE _utf8 :search COLLATE utf8_general_ci',
            )
            .orWhere(
              'CONVERT(tag.tag  USING utf8) LIKE _utf8 :search COLLATE utf8_general_ci',
            );
        }),
      );
    }

    sql.addGroupBy('clip.id');

    let count;
    // Con HAVING getCount no discrimina, a falta de una solución mejor hago esto
    if (query.tags && query.tags.length > 0) {
      const all = await sql.getRawMany();
      count = all.length;
    } else {
      count = sql.getCount();
    }

    sql.addSelect(
      'clip.title as title, clip.start as start, clip.end as end, ' +
        'clip.id as id, values.down as down, values.up as up, values.points as points',
    );

    sql
      .addOrderBy('clip.id', 'DESC')
      .limit(query.limit || 10)
      .offset(((query.page || 1) - 1) * (query.limit || 10));

    const raw = await sql.getRawMany();

    let result;
    if (raw.length > 0) {
      result = await this.clipRepository
        .createQueryBuilder('clip')
        .whereInIds(raw.map((e) => e.id))
        .innerJoinAndSelect('clip.episode', 'episode')
        .leftJoinAndSelect('clip.tags', 'tags')
        .addOrderBy('FIELD(clip.id, ' + raw.map((a) => a.id).join(',') + ')')
        .getMany();

      // No puedo añadir nuevas columnas hasta la 0.3, a si que me toca hacer esta chapucilla.
      // Si no supongo que podría meter la select de ordenar como subselect y añadir los campos.
      // Correct, its a hack. Official solution named addSelectAndMap will come into QueryBuilder in 0.3.0. Closing as duplicate of #296
      // https://github.com/typeorm/typeorm/issues/1822#issuecomment-376069476
      for (const res of result) {
        const rawColumn = raw.find((e) => e.id === res.id);
        res.up = rawColumn.up;
        res.down = rawColumn.down;
        res.points = rawColumn.points;
      }
    } else {
      result = [];
    }

    return {
      results: result,
      total: await count,
    };
  }

  async getClip(id: number) {
    const clip = await this.clipRepository.findOne({
      where: {
        id,
      },
      relations: ['episode', 'tags'],
    });
    if (clip) {
      return clip;
    } else {
      throw new NotFoundException();
    }
  }

  async vote(id: number, value: number, ip: string) {
    const returnData = {
      delete: 0,
      error: null,
      add: 0,
    };

    const myLastVote = await this.voteRepository.findOne({ clip: { id }, ip });

    if (myLastVote && myLastVote.value === value) {
      returnData.error = 'you have already voted';
      return returnData;
    } else if (myLastVote) {
      await this.voteRepository.delete(myLastVote);
      returnData.delete = myLastVote.value;
    }

    const vote = new Vote();
    vote.ip = ip;
    vote.value = value;
    (vote.clip = new Clip()).id = id;
    await this.voteRepository.save(vote);
    returnData.add = value;
    return returnData;
  }

  async addTag(id: number, value: string, ip: string) {
    const exist = await this.tagRepository.findOne({
      clipid: id,
      tag: value,
    });

    if (exist) {
      throw new ConflictException('Tag repeated');
    } else {
      let tag = new Tag();
      tag.clipid = id;
      tag.tag = value;
      tag.ip = ip;
      tag = await this.tagRepository.save(tag);
      return tag;
    }
  }

  async addClip(createClipDTO: CreateClipDTO, ip: string) {
    const episode = await this.episodeRepository.findOne({
      id: createClipDTO.episode,
    });

    const clip = new Clip();
    clip.start = createClipDTO.start;
    clip.end = createClipDTO.end;
    clip.episode = episode;
    clip.title = createClipDTO.title;
    clip.ip = ip;
    const clipSaved = await this.clipRepository.save(clip);

    clipSaved.tags = [];
    for (const tag of createClipDTO.tags) {
      const tagClip = new Tag();
      tagClip.tag = tag;
      tagClip.ip = ip;
      tagClip.clipid = clipSaved.id;
      const tagClipSaved = await this.tagRepository.save(tagClip);
      clipSaved.tags.push(tagClipSaved);
    }

    return clipSaved;
  }

  async playClip(id: number, ip: string) {
    const playClip = new Playback();
    playClip.ip = ip;
    // @ts-ignore
    playClip.clip = { id };
    return await this.playbackRepository.save(playClip);
  }
}
