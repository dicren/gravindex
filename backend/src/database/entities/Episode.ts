import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Clip } from './Clip';

@Entity()
export class Episode {
  @PrimaryGeneratedColumn()
  public id!: number;

  @Column()
  public title!: string;

  @Column()
  public cover!: string;

  @Column()
  public file!: string;

  @Column()
  public originalUrl!: string;

  @Column()
  public date!: Date;

  @Column({ select: false, type: 'text' })
  public description!: string;

  @OneToMany((type) => Clip, (clip) => clip.episode, {
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  public clips!: Clip[];
}
