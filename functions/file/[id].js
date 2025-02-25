export async function onRequest(context) {
    const {
        request,
        env,
        params,
    } = context;

    const url = new URL(request.url);
    let fileUrl = 'https://telegra.ph/' + url.pathname + url.search;
    let originalId = params.id;

    // 检查是否是短链接格式（6位字符）
    if (originalId.length === 6) {
        // 从KV中查找原始ID
        if (env.img_url) {
            // 列出所有KV记录
            const kvList = await env.img_url.list();
            // 遍历查找匹配的shortId
            for (const key of kvList.keys) {
                const record = await env.img_url.getWithMetadata(key.name);
                if (record && record.metadata && record.metadata.shortId === originalId) {
                    originalId = key.name;
                    break;
                }
            }
        }
    }

    if (originalId.length > 39) {
        const formdata = new FormData();
        formdata.append("file_id", originalId);

        const requestOptions = {
            method: "POST",
            body: formdata,
            redirect: "follow"
        };
        
        console.log(originalId.split(".")[0]);
        const filePath = await getFilePath(env, originalId.split(".")[0]);
        console.log(filePath);
        if (filePath) {
            fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
        }
    }

    const response = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    // Log response details
    console.log(response.ok, response.status);

    // 获取文件扩展名
    const fileExtension = originalId.split('.').pop().toLowerCase();
    
    // 创建新的Response对象，添加正确的Content-Type
    const newResponse = new Response(response.body, response);
    const contentType = getContentType(fileExtension);
    newResponse.headers.set('Content-Type', contentType);
    newResponse.headers.set('Content-Disposition', 'inline');

    // If the response is OK, proceed with further checks
    if (response.ok) {
        // Allow the admin page to directly view the image
        if (request.headers.get('Referer') === `${url.origin}/admin`) {
            return newResponse;
        }

        // Fetch KV metadata if available
        if (env.img_url) {
            const record = await env.img_url.getWithMetadata(originalId);
            console.log("Record:", record);

            // Ensure metadata exists and add default values for missing properties
            if (record && record.metadata) {
                const metadata = {
                    ListType: record.metadata.ListType || "None",
                    Label: record.metadata.Label || "None",
                    TimeStamp: record.metadata.TimeStamp || Date.now(),
                    liked: record.metadata.liked !== undefined ? record.metadata.liked : false,
                    shortId: record.metadata.shortId
                };

                // Handle based on ListType and Label
                if (metadata.ListType === "White") {
                    return newResponse;
                } else if (metadata.ListType === "Block" || metadata.Label === "adult") {
                    const referer = request.headers.get('Referer');
                    const redirectUrl = referer ? "https://static-res.pages.dev/teleimage/img-block-compressed.png" : `${url.origin}/block-img.html`;
                    return Response.redirect(redirectUrl, 302);
                }

                // Check if WhiteList_Mode is enabled
                if (env.WhiteList_Mode === "true") {
                    return Response.redirect(`${url.origin}/whitelist-on.html`, 302);
                }
            }
        }

        // If no metadata or further actions required, moderate content and add to KV if needed
        const time = Date.now();
        if (env.ModerateContentApiKey) {
            const moderateResponse = await fetch(`https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=https://telegra.ph${url.pathname}${url.search}`);
            const moderateData = await moderateResponse.json();
            console.log("Moderate Data:", moderateData);

            if (env.img_url) {
                // 获取现有记录
                const record = await env.img_url.getWithMetadata(originalId);
                const metadata = record && record.metadata ? record.metadata : {
                    ListType: "None",
                    TimeStamp: time,
                    liked: false
                };
                
                // 更新Label但保留其他元数据
                metadata.Label = moderateData.rating_label;
                
                await env.img_url.put(originalId, "", {
                    metadata: metadata
                });
            }

            if (moderateData.rating_label === "adult") {
                return Response.redirect(`${url.origin}/block-img.html`, 302);
            }
        }
    }

    return newResponse;
}

async function getFilePath(env, file_id) {
    try {
        const url = `https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${file_id}`;
        const res = await fetch(url, {
            method: 'GET',
        });

        if (!res.ok) {
            console.error(`HTTP error! status: ${res.status}`);
            return null;
        }

        const responseData = await res.json();
        const { ok, result } = responseData;

        if (ok && result) {
            return result.file_path;
        } else {
            console.error('Error in response data:', responseData);
            return null;
        }
    } catch (error) {
        console.error('Error fetching file path:', error.message);
        return null;
    }
}

// 添加getContentType辅助函数
function getContentType(extension) {
    const contentTypes = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',
        'ico': 'image/x-icon',
        'bmp': 'image/bmp'
    };
    return contentTypes[extension] || 'application/octet-stream';
}

// 生成6位短链接ID
function generateShortId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
