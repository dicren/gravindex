import * as dotenv from 'dotenv';
import * as fs from 'fs';

export class ConfigService {
  private readonly envConfig: { [key: string]: string };

  constructor() {
    this.envConfig = dotenv.parse(
      fs.readFileSync(`${process.env.NODE_ENV}.env`),
    );
  }

  get(key: string): string {
    return this.envConfig[key];
  }
}
// TODO validations https://docs.nestjs.com/techniques/configuration#validation
