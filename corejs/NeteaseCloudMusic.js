const api = require('./index.js')
const axios = require('axios')
const mm = require('music-metadata')
const md5 = require('md5')
const xml2js = require('xml2js')

class NeteseCloudMusicApi {
  constructor() {
    this.name = '网易云音乐'
    this.call_api = this.call_api.bind(this)

    this.special_api = {
      playlist_track_all: this.playlist_track_all.bind(this),
      avatar_upload: this.avatar_upload.bind(this),
      playlist_cover_update: this.playlist_cover_update.bind(this),
      cloud: this.cloud.bind(this),
      voice_upload: this.voice_upload.bind(this),
    }

    this.beforeRequest = api.beforeRequest
    this.afterRequest = api.afterRequest
  }

  async request(name, query) {
    console.log('request', name, query)
    let result
    // 特殊api处理
    if (Object.keys(this.special_api).includes(name)) {
      result = await this.special_api[name](query)
    } else {
      result = await this.call_api(name, query)
    }

    console.log(result)

    return result
  }

  async axios_request(request_param) {
    // 使用axios发送请求
    settings = {
      method: request_param.method,
      url: request_param.url,
      data: request_param.data,
      headers: request_param.headers,
    }
    return new Promise((resolve, reject) => {
      const answer = { status: 500, body: {}, cookie: [] }
      axios(settings)
        .then((res) => {
          resolve(res)
          return
        })
        .catch((err) => {
          answer.status = 502
          answer.body = { code: 502, msg: err }
          reject(answer)
        })
    })
  }

  async call_api(apiName, params) {
    // 请求接口
    let request_param = this.beforeRequest(apiName, params)

    // 处理data的编码
    if (request_param.data) {
      request_param.data = new URLSearchParams(request_param.data).toString()
    }

    // 发送请求
    let response = await this.axios_request(request_param)

    let response_result = {
      status: response.status,
      data: response.data,
      headers: response.headers,
    }

    let result = this.afterRequest(
      response_result,
      request_param.crypto,
      request_param.apiName,
    )

    return result
  }

  async playlist_track_all(query) {
    /**
     * 获取歌单全部歌曲
     * 内部封装两次请求
     */
    let detail_query = {
      id: query.id,
      cookie: query.cookie,
      ip: query.ip,
    }

    let result = await this.call_api('/playlist/detail', detail_query)

    let track_all_query = {
      detail_result: result,
      cookie: query.cookie,
      ip: query.ip,
    }
    if (query.limit) {
      track_all_query['limit'] = query.limit
    }
    if (query.offset) {
      track_all_query['offset'] = query.offset
    }

    result = await this.call_api('/playlist/track/all', track_all_query)
    return result
  }

  async avatar_upload(query) {
    let uploadInfo = await this.upload(query)

    query.uploadInfo = uploadInfo
    let result = await this.call_api('avatar_upload', query)

    // 合并返回结果
    result.data = {
      ...uploadInfo,
      ...result.data,
    }

    return result
  }

  async playlist_cover_update() {
    let uploadInfo = await this.upload(query)

    query.uploadInfo = uploadInfo
    let result = await this.call_api('playlist_cover_update', query)

    // 合并返回结果
    result.data = {
      ...uploadInfo,
      ...result.data,
    }

    return result
  }

  async cloud(query) {
    let ext = 'mp3'
    if (query.songFile.name.indexOf('flac') > -1) {
      ext = 'flac'
    }
    query.ext = ext

    const filename = query.songFile.name
      .replace('.' + ext, '')
      .replace(/\s/g, '')
      .replace(/\./g, '_')
    query.filename = filename

    const bitrate = 999000
    query.bitrate = bitrate

    if (!query.songFile) {
      return Promise.reject({
        status: 500,
        body: {
          msg: '请上传音乐文件',
          code: 500,
        },
      })
    }
    if (!query.songFile.md5) {
      // 命令行上传没有md5和size信息,需要填充
      query.songFile.md5 = md5(query.songFile.data)
      query.songFile.size = query.songFile.data.byteLength
    }
    let res = await this.call_api('cloud_upload_check', query)
    query.songId = res.songId
    if (res.needUpload) {
      let uploadInfo = await this.song_upload(query)
    }
    query.needUpload = needUpload

    let tokenRes = await this.call_api('get_upload_song', query)
    query.resourceId = tokenRes.result.resourceId
    // 获取歌曲元信息
    let artist = ''
    let album = ''
    let songName = ''
    try {
      const metadata = await mm.parseBuffer(
        query.songFile.data,
        query.songFile.mimetype,
      )
      const info = metadata.common

      if (info.title) {
        songName = info.title
      }
      if (info.album) {
        album = info.album
      }
      if (info.artist) {
        artist = info.artist
      }
      query.metadata = {
        artist,
        album,
        songName,
      }
    } catch (error) {
      console.log(error)
    }
    let res2 = await this.call_api('cloud_upload_info_v2', query)
    query.songId = res2.songId

    let result = await this.call_api('cloud', query)
    result.data = {
      ...result.data,
      ...res,
    }
    result.cookie = res.cookie
    return result
  }

  async voice_upload(query) {
    let parser = new xml2js.Parser(/* options */)

    let ext = 'mp3'
    if (query.songFile.name.indexOf('flac') > -1) {
      ext = 'flac'
    }
    query.ext = ext
    const filename =
      query.songName ||
      query.songFile.name
        .replace('.' + ext, '')
        .replace(/\s/g, '')
        .replace(/\./g, '_')
    query.filename = filename
    // query.cookie.os = 'pc'
    // query.cookie.appver = '2.9.7'
    if (!query.songFile) {
      return Promise.reject({
        status: 500,
        body: {
          msg: '请上传音频文件',
          code: 500,
        },
      })
    }
    let tokenRes = await this.call_api('get_upload_song', query)
    query.resourceId = tokenRes.result.resourceId
    query.objectKey = tokenRes.result.objectKey.replace('/', '%2F')
    query.docId = tokenRes.result.docId
    query.token = tokenRes.result.token

    const res = await axios({
      method: 'post',
      url: `https://ymusic.nos-hz.163yun.com/${query.objectKey}?uploads`,
      headers: {
        'x-nos-token': tokenRes.result.token,
        'X-Nos-Meta-Content-Type': 'audio/mpeg',
      },
      data: null,
    })
    // return xml
    const res2 = await parser.parseStringPromise(res.data)

    const res3 = await axios({
      method: 'put',
      url: `https://ymusic.nos-hz.163yun.com/${query.objectKey}?partNumber=1&uploadId=${res2.InitiateMultipartUploadResult.UploadId[0]}`,
      headers: {
        'x-nos-token': tokenRes.result.token,
        'Content-Type': 'audio/mpeg',
      },
      data: query.songFile.data,
    })

    // get etag
    const etag = res3.headers.etag

    // 文件处理
    await axios({
      method: 'post',
      url: `https://ymusic.nos-hz.163yun.com/${query.objectKey}?uploadId=${res2.InitiateMultipartUploadResult.UploadId[0]}`,
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
        'X-Nos-Meta-Content-Type': 'audio/mpeg',
        'x-nos-token': tokenRes.body.result.token,
      },
      data: `<CompleteMultipartUpload>
     <Part><PartNumber>1</PartNumber><ETag>${etag}</ETag></Part>
     </CompleteMultipartUpload>`,
    })

    // preCheck
    await this.call_api('voice_batch_upload_check', query)

    let result = await this.call_api('voice_upload', query)
    return result
  }

  async upload(query) {
    // 上传图片

    //   获取key和token
    const res = this.call_api('get_upload_image', query)
    console.log('res:::', res)
    //   上传图片
    const res2 = await axios({
      method: 'post',
      url: `https://nosup-hz1.127.net/yyimgs/${res.result.objectKey}?offset=0&complete=true&version=1.0`,
      headers: {
        'x-nos-token': res.result.token,
        'Content-Type': 'image/jpeg',
      },
      data: query.imgFile.data,
    })
    //   获取裁剪后图片的id
    const res3 = this.call_api('get_upload_cropped_image', {
      ...query,
      docId: res.result.docId,
    })

    return {
      // ...res.body.result,
      // ...res2.data,
      // ...res3.body,
      url_pre: 'https://p1.music.126.net/' + res.result.objectKey,
      url: res3.url,
      imgId: res3.id,
    }
  }

  async song_upload(query) {
    let bucket = 'jd-musicrep-privatecloud-audio-public'
    let tokenRes = await this.call_api('get_upload_song', { ...query, bucket })

    // 上传
    const objectKey = tokenRes.result.objectKey.replace('/', '%2F')
    try {
      const lbs = (
        await axios({
          method: 'get',
          url: `https://wanproxy.127.net/lbs?version=1.0&bucketname=${bucket}`,
        })
      ).data
      await axios({
        method: 'post',
        url: `http://${lbs.upload[0]}/${bucket}/${objectKey}?offset=0&complete=true&version=1.0`,
        headers: {
          'x-nos-token': tokenRes.result.token,
          'Content-MD5': query.songFile.md5,
          'Content-Type': 'audio/mpeg',
          'Content-Length': String(query.songFile.size),
        },
        data: query.songFile.data,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      })
    } catch (error) {
      console.log('error', error.response)
      throw error.response
    }
    return {
      ...tokenRes,
    }
  }
}

module.exports = {
  NeteseCloudMusicApi,
}
