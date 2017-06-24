/**
 * Copyright 2016 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for t`he specific language governing permissions and
 * limitations under the License.
 */
'use strict';

const functions = require('firebase-functions');
const mkdirp = require('mkdirp-promise');
// Include a Service Account Key to use a Signed URL
const gcs = require('@google-cloud/storage')({keyFilename:
    'cloud-functions-f199c-firebase-adminsdk-vn436-1699cb8c56.json'});
const admin = require('firebase-admin');
const spawn = require('child-process-promise').spawn;
const LOCAL_TMP_FOLDER = '/tmp/';

// Max height and width of the thumbnail in pixels.
const THUMB_MAX_HEIGHT = 200;
const THUMB_MAX_WIDTH = 200;
// Thumbnail prefix added to file names.
const THUMB_PREFIX = 'thumb_';
admin.initializeApp(functions.config().firebase);
const ref = admin.database().ref();

/**
 * When an image is uploaded in the Storage bucket We generate a thumbnail automatically using
 * ImageMagick.
 * After the thumbnail has been generated and uploaded to Cloud Storage,
 * we write the public URL to the Firebase Realtime Database.
 */
exports.generateThumbnail = functions.storage.object().onChange(event => {

  const fileBucket = event.data.bucket;
  const bucket = gcs.bucket(fileBucket);
  const filePath = event.data.name;
  console.log('file path is  =.'+filePath);
  const file = bucket.file(filePath);
  console.log('file is  =.'+file);
  const filePathSplit = filePath.split('/');
  console.log('file pathSplit is  =.'+filePathSplit);
  const fileName = filePathSplit.pop();
  console.log('file name after pop is= ' +fileName);
  const fileDir = filePathSplit.join('/') + (filePathSplit.length > 0 ? '/' : '');
  const thumbFilePath = `${fileDir}${THUMB_PREFIX}${fileName}`;
  const tempLocalDir = `${LOCAL_TMP_FOLDER}${fileDir}`;
  const tempLocalFile = `${tempLocalDir}${fileName}`;
  const tempLocalThumbFile = `${LOCAL_TMP_FOLDER}${thumbFilePath}`;
  const thumbFile = bucket.file(thumbFilePath);

  /*
  *Profile pic is stored using user uid. (K69NjweykhVcmTg7CdtaaYye3fz2.jpg)
  *so we split the uid to get an array,the first element of the array will be (K69NjweykhVcmTg7CdtaaYye3fz2)
  *which we use as a child of Users.
  */
  const databaseUserChild = fileName.split('.');

  //Exist if file upload was not in profile_images folder
  if (!filePath.startsWith('profile_images')) {
    console.log('This is not an image for profile_images folder');
    return;
  }

  // Exit if this is triggered on a file that is not an image.
  if (!event.data.contentType.startsWith('image/')) {
    console.log('This is not an image.');
    return;
  }

  // Exit if the image is already a thumbnail.
  if (fileName.startsWith(THUMB_PREFIX)) {
    console.log('Already a Thumbnail.');
    return;
  }

  // Exit if this is a move or deletion event.
  if (event.data.resourceState === 'not_exists') {
    console.log('This is a deletion event.');
    return;
  }

  // Create the temp directory where the storage file will be downloaded.
  return mkdirp(tempLocalDir).then(() => {
    // Download file from bucket.
    return bucket.file(filePath).download({
      destination: tempLocalFile
    });
  }).then(() => {
    console.log('The file has been downloaded to', tempLocalFile);
    // Generate a thumbnail using ImageMagick.
    return spawn('convert', [tempLocalFile, '-thumbnail', `${THUMB_MAX_WIDTH}x${THUMB_MAX_HEIGHT}>`, tempLocalThumbFile]);
  }).then(() => {
    console.log('Thumbnail created at', tempLocalThumbFile);
    // Uploading the Thumbnail.
    return bucket.upload(tempLocalThumbFile, {
      destination: thumbFilePath
    })
  }).then(() => {
    console.log('Thumbnail uploaded to Storage at', thumbFilePath);
  }).then(() => {
    const config = {
      action: 'read',
      expires: '03-01-2500'
    };
    // Get the Signed URL for the thumbnail and original images
    return Promise.all([
      thumbFile.getSignedUrl(config),
      file.getSignedUrl(config),
    ]);
  }).then(results => {
    console.log('Got Signed URL');
    const thumbResult = results[0];
    const originalResult = results[1];
    const thumbFileUrl = thumbResult[0];
    const fileUrl = originalResult[0];
    // Add the URLs to the Database
    return ref.child('Users').child(databaseUserChild[0]).update({
      image: fileUrl,
      thumb_image: thumbFileUrl
    }) ;
  }).catch(reason => {
    console.error(reason);
  });


})
