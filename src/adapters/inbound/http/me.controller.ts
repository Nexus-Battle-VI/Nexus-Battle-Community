import { Controller, Get, Inject } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import type { ListOwnPosts } from '../../../application/use-cases/ThreadUseCases'
import type { VerifiedIdentity } from '../../../application/ports/TokenVerifierPort'
import { CurrentIdentity } from './auth/decorators'
import { OwnPostResponse } from './me.dto'
import { LIST_OWN_POSTS } from './tokens'

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(@Inject(LIST_OWN_POSTS) private readonly listOwnPosts: ListOwnPosts) {}

  @Get('posts')
  @ApiOperation({ summary: 'Recupera los mensajes propios para privacidad' })
  @ApiResponse({ status: 200, type: OwnPostResponse, isArray: true })
  @ApiResponse({ status: 401, description: 'Testimonio ausente o invalido' })
  async posts(@CurrentIdentity() identity: VerifiedIdentity): Promise<readonly OwnPostResponse[]> {
    return await this.listOwnPosts.execute(identity.subject)
  }
}
