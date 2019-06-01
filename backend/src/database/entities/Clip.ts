import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Episode } from './Episode';
import { Vote } from './Vote';
import { Tag } from './Tag';
import { Playback } from './Playback';

@Entity()
export class Clip {
  @PrimaryGeneratedColumn()
  public id!: number;

  @Column()
  public title!: string;

  @Column()
  public start!: number;

  @Column()
  public end!: number;

  @ManyToOne(type => Episode, episode => episode.clips, {
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'episode' })
  public episode!: Episode;

  @Column({ select: false })
  public ip!: string;
  @CreateDateColumn({ select: false })
  public createdAt: Date;

  @OneToMany(type => Vote, vote => vote.clip, {
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  public votes!: Vote[];

  @OneToMany(type => Playback, playback => playback.clip, {
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  public playbacks!: Playback[];

  @OneToMany(type => Tag, tagclip => tagclip.clip, {
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  public tags!: Tag[];

  public up!: number;
  public down!: number;
  public points!: number;
}
