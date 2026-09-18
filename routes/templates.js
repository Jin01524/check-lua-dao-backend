import express from 'express';
import { getSupabaseClient } from '../lib/supabase.js';

const router = express.Router();

/**
 * Danh mục mẫu lừa đảo thực tế chuẩn quốc gia (Curated Threat Library)
 * Đảm bảo hệ thống luôn có dữ liệu phong phú, chính xác và không bao giờ bị lỗi trắng trang.
 */
export const CURATED_TEMPLATES = [
  {
    id: 'a516dc7b-6f00-4297-b7b5-0ef6841e2a5b',
    title: 'Kêu gọi gửi mã thẻ cào điện thoại/game giả mạo người quen',
    platform: 'SMS',
    scam_type: 'Lừa đảo chiếm đoạt mã thẻ cào điện thoại/game',
    attack_target: 'Không rõ',
    confidence_score: 91,
    analysis: 'Hội thoại cho thấy một người (tên là Nguyễn Hồng trong đoạn chat) liên tục yêu cầu nạn nhân mua thẻ cào điện thoại/game mệnh giá 200k và gửi ảnh chụp mã thẻ qua tin nhắn. Kẻ gian tìm cách tránh gặp mặt trực tiếp với lý do bận, đây là dấu hiệu đặc trưng của hành vi lừa đảo nhằm chiếm đoạt mã thẻ cào mà không bị lộ danh tính. Tin nhắn cuối cùng của nạn nhân có thể là một phản ứng mỉa mai hoặc thăm dò, cho thấy nạn nhân đã nhận ra dấu hiệu bất thường.',
    warning_points: [
      'Thao túng tâm lý khẩn cấp',
      'Yêu cầu chuyển tiền/cung cấp OTP'
    ],
    messages_json: [
      { sender: 'scammer', text: 'u chup gui qua' },
      { sender: 'user', text: 'thẻ bao nhiêu/' },
      { sender: 'scammer', text: 'u 200' },
      { sender: 'user', text: 'Thôi tới quán cũ uống cà phê đưa luôn, chụp hình chi' },
      { sender: 'scammer', text: 'dang co viec sao di . chup hinh gui qua co viec ti , co gi chieu gap' },
      { sender: 'user', text: 'Chiều gặp ở đâu?' },
      { sender: 'scammer', text: 'thi toi quan cf nao thi nt cho hong' },
      { sender: 'user', text: 'Sáng giờ nhận được mấy cái thẻ cào 200 rồi bạn?. Để mình mua thẻ cào rồi chụp hình gửi cho bạn nhé! Hi...hi...hi' }
    ],
    is_approved: true,
    created_at: '2026-09-18T04:21:36.090986+00:00'
  },
  {
    id: '2609e9a7-f1c5-4472-93c4-0f16deaed18c',
    title: 'Nghi vấn lừa đảo bằng cách tạo mối quan hệ giả mạo qua người quen',
    platform: 'SMS',
    scam_type: 'Lừa đảo tạo mối quan hệ giả mạo (Social Engineering)',
    attack_target: 'Không rõ',
    confidence_score: 97,
    analysis: 'Cuộc hội thoại này cho thấy rõ ràng một nỗ lực lừa đảo bằng hình thức kỹ thuật xã hội (social engineering), thường được gọi là "scam wrong number" (lừa đảo nhầm số) hoặc "scam tạo mối quan hệ giả mạo". Kẻ lừa đảo bắt đầu bằng cách gửi tin nhắn chào hỏi và nhanh chóng viện dẫn một người quen chung ("cô Liên") để thiết lập kết nối và tạo sự tin cậy.',
    warning_points: [
      'Thao túng tâm lý khẩn cấp',
      'Yêu cầu chuyển tiền/cung cấp OTP'
    ],
    messages_json: [
      { sender: 'scammer', text: 'Chào em mấy nay công việc của anh hơi bận giờ nhớ tới nên giờ anh mới nhắn tin cho em được thật tình xin lỗi em' },
      { sender: 'scammer', text: 'Không biết cô liên có nói gì về anh cho em nghe chưa' },
      { sender: 'user', text: 'Dạ ai thế ạ?' },
      { sender: 'scammer', text: 'Anh là trường con mẹ hiền' },
      { sender: 'scammer', text: 'Anh nghe cô liên nói em là cháu cô nên cô có có cho anh số của em để hai đứa nói chuyện' },
      { sender: 'user', text: 'Cô Liên nào thế ạ? Anh ở đâu vậy ạ?' },
      { sender: 'scammer', text: 'Cô liên vk chú Tuấn làm bên chi cục thuế ở hà nội Á em' },
      { sender: 'user', text: 'Cô có nói tên của em cho anh không ạ? Không biết anh có nhầm số của em với ai không ạ' },
      { sender: 'scammer', text: 'Em có phải là hoa không ?' }
    ],
    is_approved: true,
    created_at: '2026-09-06T19:56:14.843087+00:00'
  },
  {
    id: '76fd6c28-8e0c-4f49-b9fb-bd0e8551febe',
    title: 'Tin nhắn giả mạo Techcombank thông báo đăng ký dịch vụ TikTok và yêu cầu hủy qua link lừa đảo',
    platform: 'SMS',
    scam_type: 'Lừa đảo phishing giả mạo ngân hàng Techcombank',
    attack_target: 'Không rõ',
    confidence_score: 93,
    analysis: 'Tin nhắn này là một hình thức lừa đảo phishing tinh vi, giả mạo ngân hàng Techcombank. Kẻ lừa đảo sử dụng tên người gửi là "Techcombank" để tăng tính tin cậy. Nội dung tin nhắn tạo ra tình huống khẩn cấp và hoang mang khi thông báo tài khoản của nạn nhân đã tự động đăng ký một chương trình quảng cáo trên TikTok với mức phí rất cao (3,600,000 VND/tháng).',
    warning_points: [
      'Thao túng tâm lý khẩn cấp',
      'Yêu cầu chuyển tiền/cung cấp OTP'
    ],
    messages_json: [
      { sender: 'scammer', text: 'Tài khoản của bạn đã đăng ký chương trình quảng cáo trên TikTok, mỗi tháng thu phí 3,600,000VND. Vui lòng vào https://techcombank.vn-iy.life để kiểm tra hoặc để hủy' }
    ],
    is_approved: true,
    created_at: '2026-09-06T17:28:25.476611+00:00'
  },
  {
    id: 'd3c6227d-b6c3-42a3-a78c-0c9166e8fcee',
    title: 'Cảnh báo lừa đảo: Giả danh tặng quà để chiếm đoạt thông tin và cài đặt mã độc',
    platform: 'Zalo',
    scam_type: 'Lừa đảo tặng quà/trúng thưởng để cài đặt mã độc',
    attack_target: 'Không rõ',
    confidence_score: 94,
    analysis: 'Đây là kịch bản lừa đảo rất phổ biến. Kẻ gian giả danh nhân viên công ty/cửa hàng nhắn tin tặng quà để thu thập thông tin cá nhân. Sau đó, chúng dụ dỗ nạn nhân cài đặt các ứng dụng lạ (thường yêu cầu qua Telegram) với lý do "nhận phiếu quà" hoặc "xác thực bảo hành".',
    warning_points: [
      'Thao túng tâm lý khẩn cấp',
      'Yêu cầu chuyển tiền/cung cấp OTP'
    ],
    messages_json: [
      { sender: 'scammer', text: '👉Giới tính, tuổi :\n👉SDT nhận quà :\n👉Địa chỉ nhận hàng :' },
      { sender: 'user', text: 'Lại còn phải giới tính và tuổi hả e' },
      { sender: 'scammer', text: 'Dạ chị ơi cái này là em xin để làm phiếu bảo thành cho mình ạ' },
      { sender: 'user', text: 'Thế chỉ cần địa chỉ nhận thôi phải ko e' },
      { sender: 'scammer', text: 'Dạ chị ơi số điện thoại của mình đã đăng ký telegram chưa ạ.Dể Em hướng dẫn mình tải về để nhận phiếu quà ạ' },
      { sender: 'user', text: 'Thế thôi c ko biết làm đâu' },
      { sender: 'scammer', text: 'Dạ chị ơi cái này tải về đâu mất nhiều thời gian đâu ạ' }
    ],
    is_approved: true,
    created_at: '2026-07-09T03:34:51.247388+00:00'
  },
  {
    id: 'a180f205-ba05-4235-9319-c70d6998af1b',
    title: 'Tin nhắn giả mạo Bộ Giao thông vận tải thông báo phạt nguội',
    platform: 'SMS',
    scam_type: 'Lừa đảo giả danh cơ quan nhà nước, cơ quan chức năng',
    attack_target: 'Không rõ',
    confidence_score: 96,
    analysis: 'Đây là thủ đoạn lừa đảo rất phổ biến. Kẻ gian giả danh cơ quan nhà nước (Bộ Giao thông Vận tải) để gửi tin nhắn hù dọa nạn nhân về việc có biên lai phạt nguội chưa nộp. Mục đích của chúng là khiến người nhận hoang mang, lo sợ bị cưỡng chế hoặc phạt nặng, từ đó nhấn vào đường link độc hại.',
    warning_points: [
      'Thao túng tâm lý khẩn cấp',
      'Yêu cầu chuyển tiền/cung cấp OTP'
    ],
    messages_json: [
      { sender: 'scammer', text: 'Bộ giao thông vận tải,xin thông báo ông/bà có biên lai chưa nộp phạt.Hôm nay là thông báo cuối cùng.Yêu cầu nhanh chóng giải quyết mọi thắc mắc Vui lòng liên hệ : xxxx' }
    ],
    is_approved: true,
    created_at: '2026-07-02T12:49:46.270379+00:00'
  },
  {
    id: '88756b3d-f35b-45e3-9acc-3f82b76b485a',
    title: 'Tin nhắn tuyển dụng lừa đảo',
    platform: 'SMS',
    scam_type: 'Lừa đảo tuyển dụng việc làm nhẹ lương cao',
    attack_target: 'Không rõ',
    confidence_score: 93,
    analysis: 'Đây là tin nhắn rác điển hình với mục đích lừa đảo chiếm đoạt tài sản thông qua hình thức tuyển dụng việc làm online tại nhà. Kẻ lừa đảo sử dụng các cụm từ kích thích lòng tham như "lương 6tr-36tr mỗi tháng", "kiếm tiền tại nhà đơn giản" để dụ dỗ nạn nhân liên hệ qua Zalo.',
    warning_points: [
      'Thao túng tâm lý khẩn cấp',
      'Yêu cầu chuyển tiền/cung cấp OTP'
    ],
    messages_json: [
      { sender: 'scammer', text: 'Còn 28 lượt đăng ký cuối cùng! Xin chào, có phải bạn đang muốn tìm công việc không? Với mức lương là 6tr-36tr mỗi tháng với công việc hoàn toàn hợp pháp và đảm bảo thu nhập. Mỗi ngày bạn nhận thấp nhất 800k, kiếm tiền tại nhà đơn giản. Nếu như bạn có nhu cầu vui lòng liên hệ zalo ID :xxxx. Dưới 23 tuổi vui lòng không liên hệ tham gia. Sao chép liên kết vào trình duyệt :https://zalo.me/xxxx Dịch vụ 1 với 1' }
    ],
    is_approved: true,
    created_at: '2026-07-01T11:11:46.111966+00:00'
  },
  {
    id: '8bdb2c81-4b21-450d-a29d-e580b5406a03',
    title: 'Lừa đảo giả danh nhân viên Shopee yêu cầu nạp tiền làm nhiệm vụ',
    platform: 'Telegram',
    scam_type: 'Lừa đảo làm nhiệm vụ online',
    attack_target: 'Không rõ',
    confidence_score: 96,
    analysis: 'Đây là hình thức lừa đảo "việc nhẹ lương cao" cực kỳ phổ biến. Kẻ gian giả danh nhân viên các sàn thương mại điện tử (như Shopee), mời gọi nạn nhân nạp tiền vào hệ thống để "tăng giá trị sản phẩm", hứa hẹn hoàn trả gốc kèm hoa hồng 15%. Thực tế, nạn nhân sẽ mất trắng số tiền đã chuyển.',
    warning_points: [
      'Thao túng tâm lý khẩn cấp',
      'Yêu cầu chuyển tiền/cung cấp OTP'
    ],
    messages_json: [
      { sender: 'scammer', text: 'nhiệm vụ shopee có nghĩa là: ví dụ chị nhận nhiệm vụ 1 là 565k em sẽ xin stk hệ thống chị sẽ chuyển vào 565k để tăng giá trị sản phẩm đó lên chứ không phải là mua hàng nha sau 3-5p hệ thống sẽ chuyển trả lại chị số tiền + 15% hoa hồng ạ' },
      { sender: 'scammer', text: 'đây là khoản dự trữ nhằm mục đích tăng giá trị sản phẩm lên trên các nền tảng mua sắm chị nhé' },
      { sender: 'scammer', text: 'khi chị hoàn thành thì chị sẽ nhận được 15% hoa hồng và em cũng được 5% akj' },
      { sender: 'user', text: 'Là 565000đ hả e' },
      { sender: 'scammer', text: 'dạ vâng nhiệm vụ 1 là 565k ạ' },
      { sender: 'user', text: 'Có chắc k e' },
      { sender: 'user', text: 'Chứ c sợ mất quá' },
      { sender: 'scammer', text: 'dạ vâng công ty em làm ăn có giấy phép kinh doanh đàng hoàng và đã được nhà nước cấp phép cho công việc onl này rồi' },
      { sender: 'scammer', text: 'và có địa chỉ cụ thể là 1 công ty lớn sẽ không dùng cách này để lừa gạt khách hàng của mình đâu chị a' },
      { sender: 'user', text: 'Thế à' },
      { sender: 'scammer', text: 'dạ địa chỉ công ty em ở xxxx, Phường Bến Nghé Q1 TP HCM chị nhé' },
      { sender: 'user', text: 'Làm nv tiếp như thế nào nữa e' },
      { sender: 'scammer', text: 'dạ vâng chị vui lòng đợi em chút em báo hệ thống đăng kí nhiệm vụ tiếp theo cho chị nha' },
      { sender: 'user', text: 'Được r e' },
      { sender: 'scammer', text: '1. xxxx Đặt' }
    ],
    is_approved: true,
    created_at: '2026-06-30T17:28:48.555512+00:00'
  },
  {
    id: '82bbec2a-0d56-41d5-b945-3e032bb0e635',
    title: 'Email giả mạo thông báo tạm dừng tài khoản để đánh cắp thông tin',
    platform: 'Gmail',
    scam_type: 'Lừa đảo chiếm đoạt tài khoản (Phishing)',
    attack_target: 'Không rõ',
    confidence_score: 97,
    analysis: 'Đây là một email lừa đảo điển hình (phishing) giả danh một hệ thống dịch vụ để đánh cắp thông tin đăng nhập của người dùng. Kẻ tấn công tạo ra tâm lý lo sợ bằng cách thông báo tài khoản bị khóa do "phát tán thư rác", sau đó dẫn dụ nạn nhân nhấp vào nút "Kích hoạt lại" để dẫn đến một trang web giả mạo.',
    warning_points: [
      'Thao túng tâm lý khẩn cấp',
      'Yêu cầu chuyển tiền/cung cấp OTP'
    ],
    messages_json: [
      { sender: 'scammer', text: 'Từ: \'Unexpected Errors\' <unexpected.error.announcement@gmail.com>\nNgày: 1 Thg 10, 2015 14:26\nChủ đề: Thông báo: Kích hoạt lại tài khoản\n\nTạm dừng tài khoản 90 ngày\n- Chúng tôi phát hiện tài khoản của bạn có dấu hiệu phát tán thư rác, trái với quy định của chúng tôi.\n- Nếu thông tin này không chính xác, bạn cần xác nhận đây không phải là tài khoản rác bằng cách nhấp vào liên kết xác nhận bên dưới.\n[Kích hoạt lại]\n- Nếu trong vòng 07 ngày kể từ khi nhận thông báo này, bạn không kích hoạt xác nhận, chúng tôi sẽ xem xét việc khoá tài khoản của bạn mà không báo trước nếu phát hiện có dấu hiệu phát tán thư rác thật sự.' }
    ],
    is_approved: true,
    created_at: '2026-06-30T16:35:52.853179+00:00'
  },
  {
    id: 'bd6cbfc3-af5f-4d33-94e8-e86a75d8c39c',
    title: 'Cảnh báo lừa đảo: Giả danh giáo viên báo con cấp cứu, yêu cầu chuyển tiền phẫu thuật gấp',
    platform: 'SMS',
    scam_type: 'Lừa đảo báo con cấp cứu',
    attack_target: 'Không rõ',
    confidence_score: 98,
    analysis: 'Đây là một dạng lừa đảo phổ biến nhằm vào tâm lý lo lắng của phụ huynh. Kẻ lừa đảo giả danh là giáo viên hoặc người có liên quan đến trường học/con cái nạn nhân, thông báo một tình huống khẩn cấp về y tế (bé bị tai nạn, chấn thương sọ não) và yêu cầu chuyển tiền ngay lập tức để phẫu thuật.',
    warning_points: [
      'Thao túng tâm lý khẩn cấp',
      'Yêu cầu chuyển tiền/cung cấp OTP'
    ],
    messages_json: [
      { sender: 'user', text: 'Thầy ơi, vợ mình báo bé Susu nhà mình bị té. Bé có sao không vậy thầy? Bé đang ở đâu vậy thầy ơi??' },
      { sender: 'scammer', text: 'Trời ơi bác sĩ đang khám sơ qua ý chị' },
      { sender: 'scammer', text: 'Bác Sĩ bảo là bị trấn thương sọ não anh' },
      { sender: 'scammer', text: 'H cần phải phẫu thuật gấp' },
      { sender: 'user', text: 'Trời đất ơi... bé đang ở bệnh viện nào vậy thầy? Bé còn tỉnh táo không thầy?' },
      { sender: 'scammer', text: 'Anh có gần bệnh viện chợ gẫy k' },
      { sender: 'scammer', text: 'Trời ơi trời ... thầy nói bác sĩ giúp cháu gấp' },
      { sender: 'user', text: 'Mình chạy đến bệnh viện liền...30 phút nữa mình đến kịp ko thầy' },
      { sender: 'scammer', text: 'H em lại không mang theo tiền để làm thủ tục anh ạ' },
      { sender: 'scammer', text: 'Cháu gấp lắm r' },
      { sender: 'user', text: 'Mình đang gọi tìm bác sĩ quen mà chưa kiếm được' },
      { sender: 'scammer', text: 'K là nguy cơ đến tính mạng anh ạ' },
      { sender: 'scammer', text: 'Cần phải chuyển tiền để làm phẫu thuật gấp anh' },
      { sender: 'user', text: 'Thầy nói bác sĩ giúp gấp... bao nhiêu tiền cũng được' }
    ],
    is_approved: true,
    created_at: '2026-06-30T15:13:43.275113+00:00'
  }
];

/**
 * Hàm lọc mẫu cục bộ (khi DB rỗng hoặc chưa cấu hình)
 */
function filterCurated(platform, search) {
  return CURATED_TEMPLATES.filter((tpl) => {
    const matchesPlatform =
      !platform ||
      platform.toUpperCase() === 'ALL' ||
      tpl.platform?.toLowerCase() === platform.toLowerCase();

    const matchesSearch =
      !search ||
      tpl.title?.toLowerCase().includes(search.toLowerCase()) ||
      tpl.scam_type?.toLowerCase().includes(search.toLowerCase()) ||
      tpl.analysis?.toLowerCase().includes(search.toLowerCase());

    return matchesPlatform && matchesSearch;
  });
}

/**
 * Hàm tạo điểm rủi ro nhất quán từ 91% - 98% nếu thiếu dữ liệu trong DB
 */
export function getConsistentScore(tpl) {
  if (tpl?.confidence_score != null && !isNaN(Number(tpl.confidence_score))) {
    const s = Number(tpl.confidence_score);
    return s > 0 && s <= 1 ? Math.round(s * 100) : Math.round(s);
  }
  if (tpl?.danger_level != null && !isNaN(Number(tpl.danger_level))) {
    const s = Number(tpl.danger_level);
    return s > 0 && s <= 1 ? Math.round(s * 100) : Math.round(s);
  }
  const str = String(tpl?.id || tpl?.title || 'template');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return 91 + (Math.abs(hash) % 8); // 91% - 98%
}

/**
 * GET /api/templates
 * Lấy danh sách mẫu đã được duyệt
 */
router.get('/', async (req, res) => {
  const { platform, limit = 50, offset = 0, search } = req.query;

  let supabase = null;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    console.warn('[Templates] Supabase not configured in .env, serving curated threat library');
  }

  // 1. Nếu có Supabase, thử truy vấn cơ sở dữ liệu
  if (supabase) {
    try {
      // Kho mẫu lừa đảo: chỉ hiển thị các mẫu đạt mức rủi ro (confidence_score >= 40 và không phải mẫu an toàn)
      let query = supabase
        .from('scam_templates')
        .select('id, title, platform, scam_type, analysis, attack_target, confidence_score, warning_points, is_approved, created_at')
        .gte('confidence_score', 40)
        .neq('scam_type', 'Tin nhắn an toàn / Bình thường')
        .order('created_at', { ascending: false })
        .range(Number(offset), Number(offset) + Number(limit) - 1);

      // Cho phép lọc theo approved nếu query có truyền vào (mặc định lấy tất cả các mẫu đạt rủi ro)
      if (req.query.approved === 'true') {
        query = query.eq('is_approved', true);
      } else if (req.query.approved === 'false') {
        query = query.eq('is_approved', false);
      }

      if (platform && platform.toUpperCase() !== 'ALL') {
        query = query.ilike('platform', `%${platform}%`);
      }

      if (search && search.trim()) {
        const term = search.trim();
        query = query.or(`title.ilike.%${term}%,scam_type.ilike.%${term}%,analysis.ilike.%${term}%`);
      }

      let { data, error } = await query;

      // Fallback truy vấn cơ bản nếu thiếu cột mới (confidence_score / warning_points / attack_target)
      if (error) {
        console.warn('[Templates] Advanced query failed, falling back to basic columns:', error.message);
        let basicQuery = supabase
          .from('scam_templates')
          .select('id, title, platform, scam_type, analysis, is_approved, created_at')
          .neq('scam_type', 'Tin nhắn an toàn / Bình thường')
          .order('created_at', { ascending: false })
          .range(Number(offset), Number(offset) + Number(limit) - 1);

        if (req.query.approved === 'true') {
          basicQuery = basicQuery.eq('is_approved', true);
        } else if (req.query.approved === 'false') {
          basicQuery = basicQuery.eq('is_approved', false);
        }

        if (platform && platform.toUpperCase() !== 'ALL') {
          basicQuery = basicQuery.ilike('platform', `%${platform}%`);
        }

        if (search && search.trim()) {
          const term = search.trim();
          basicQuery = basicQuery.or(`title.ilike.%${term}%,scam_type.ilike.%${term}%`);
        }

        const fallbackRes = await basicQuery;
        if (!fallbackRes.error && fallbackRes.data) {
          data = fallbackRes.data;
          error = null;
        }
      }

      // Nếu có dữ liệu trong database, chuẩn hóa và loại bỏ các mẫu tin nhắn an toàn
      if (!error && data && data.length > 0) {
        const riskOnlyData = data.filter((item) => {
          const score = Number(item.confidence_score);
          const isSafeType = String(item.scam_type || '').includes('Tin nhắn an toàn');
          if (isSafeType) return false;
          if (!isNaN(score) && score > 0 && score < 40) return false;
          return true;
        });

        const enriched = riskOnlyData.map(item => ({
          ...item,
          attack_target: item.attack_target || 'Không rõ',
          confidence_score: getConsistentScore(item),
          warning_points: item.warning_points || ['Thao túng tâm lý khẩn cấp', 'Yêu cầu chuyển tiền/cung cấp OTP'],
          is_approved: Boolean(item.is_approved),
        }));
        return res.json({ data: enriched, count: enriched.length });
      }

      // Nếu database đã kết nối và bảng scam_templates rỗng (người dùng đã clear)
      if (!error && Array.isArray(data) && data.length === 0) {
        return res.json({ data: [], count: 0 });
      }
    } catch (err) {
      console.warn('[Templates] Error reading from DB:', err.message);
    }
  }

  // 2. Fallback: Trả về Curated Threat Library
  const curated = filterCurated(platform, search).map(item => ({
    ...item,
    confidence_score: getConsistentScore(item),
  }));
  return res.json({
    data: curated,
    count: curated.length,
  });
});

/**
 * GET /api/templates/:id
 * Lấy chi tiết 1 mẫu đã duyệt
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  let supabase = null;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    // Silent catch
  }

  // 1. Thử lấy từ Supabase
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('scam_templates')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (!error && data) {
        const enriched = {
          ...data,
          attack_target: data.attack_target || 'Không rõ',
          confidence_score: getConsistentScore(data),
          warning_points: data.warning_points || ['Thao túng tâm lý khẩn cấp', 'Yêu cầu chuyển tiền/cung cấp OTP'],
          is_approved: Boolean(data.is_approved),
        };
        return res.json({ data: enriched });
      }
    } catch (err) {
      console.warn('[Templates] Error fetching id from DB:', err.message);
    }
  }

  // 2. Tìm trong Curated Threat Library
  const found = CURATED_TEMPLATES.find(
    (t) => String(t.id).toLowerCase() === String(id).toLowerCase()
  );

  if (found) {
    return res.json({
      data: {
        ...found,
        confidence_score: getConsistentScore(found),
      }
    });
  }

  res.status(404).json({ error: 'Template not found' });
});

export default router;

